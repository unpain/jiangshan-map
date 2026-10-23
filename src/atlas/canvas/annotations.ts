import { MapElement } from '../layers/element';
import { resolveStyle, styleFor, type LayerStyle, type StyleContext } from '../layers/style';
import { localMatrix, shapeBounds, shapePath, transformBounds, type Bounds, type Frame } from './geometry';
import { paintItem, readPaint, readText, setStrokeStyle, textBounds, type Paint, type TextRun } from './paint';

export const GEOGRAPHY = ['neighbors', 'provinces', 'polities', 'prefectures', 'rivers', 'ghost-diff'].map(id => ({id: `grp-${id}`}));

interface Item {
  node: MapElement; matrix: DOMMatrix; inverse: DOMMatrix; paint: Paint;
  path?: Path2D; text?: TextRun; bounds?: Bounds; worldBounds?: Bounds;
}

/** Leaflet features compile to reusable drawing commands for fluid camera movement. */
export class CanvasAnnotations {
  readonly ctx: CanvasRenderingContext2D;
  items: Item[] = [];
  private hovered = new Set<MapElement>();

  constructor(readonly root: MapElement, readonly canvas: HTMLCanvasElement,
    readonly frame: () => Frame, readonly viewport: () => DOMRect, readonly context: () => StyleContext) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Recompile only for content/style changes, independently of camera movement. */
  rebuild() {
    this.items = [];
    this.visit(this.root, new DOMMatrix(), 1);
  }

  /** A single tree walk preserves paint order and inherited visibility/opacity. */
  private visit(node: MapElement, parent: DOMMatrix, opacity: number, parentStyle?: LayerStyle) {
    if (!node.attached || node.id === 'grp-terrain') return;
    if (node.kind === 'path' && node.ancestor(GEOGRAPHY)) return;
    if (node.kind === 'path' && !node.has('d')) return;
    const css = resolveStyle(node, this.context(), parentStyle);
    if ((node !== this.root && css.display === 'none') || css.visibility === 'hidden') return;
    opacity *= Number(css.opacity);
    if (!opacity) return;
    const matrix = node === this.root ? parent : parent.multiply(localMatrix(node, css));
    if (node === this.root || node.kind === 'group') {
      for (const child of node.children) this.visit(child, matrix, opacity, css);
      return;
    }
    this.addItem(node, css, matrix, opacity);
  }

  /** Cache paths, metrics and inverse transforms for both drawing and picking. */
  private addItem(node: MapElement, css: LayerStyle, matrix: DOMMatrix, opacity: number) {
    const path = shapePath(node), text = node.kind === 'text' ? readText(node, css) : undefined;
    if (!path && !text) return;
    const bounds = text ? textBounds(this.ctx, text) : shapeBounds(node);
    this.items.push({node, matrix, inverse: matrix.inverse(), paint: readPaint(css, opacity),
      path, text, bounds, worldBounds: bounds ? transformBounds(bounds, matrix) : undefined});
  }

  /** One viewport-sized surface avoids large bitmap copies and overscan buffers. */
  private resize(width: number, height: number, dpr: number) {
    const w = Math.ceil(width * dpr), h = Math.ceil(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    }
    this.ctx.resetTransform(); this.ctx.clearRect(0, 0, w, h);
  }

  /** Gesture frames use only cached commands and the latest camera transform. */
  draw(frame: Frame, width: number, height: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), ctx = this.ctx;
    this.resize(width, height, dpr);
    for (const item of this.items) {
      if (this.outside(item, frame, width, height)) continue;
      const m = item.matrix, scale = frame.scale;
      ctx.setTransform(m.a * scale * dpr, m.b * scale * dpr, m.c * scale * dpr,
        m.d * scale * dpr, (m.e * scale + frame.x) * dpr, (m.f * scale + frame.y) * dpr);
      setStrokeStyle(ctx, item.paint, scale * Math.hypot(m.a, m.b));
      paintItem(ctx, item.paint, item.path, item.text);
    }
  }

  /** Cull labels with padding for halos and fixed-width strokes. */
  private outside(item: Item, frame: Frame, width: number, height: number) {
    const b = item.worldBounds;
    if (!b) return false;
    const pad = Math.max(8, item.paint.width * Math.max(1, frame.scale * Math.hypot(item.matrix.a, item.matrix.b)));
    return b.x * frame.scale + frame.x > width + pad ||
      (b.x + b.width) * frame.scale + frame.x < -pad ||
      b.y * frame.scale + frame.y > height + pad ||
      (b.y + b.height) * frame.scale + frame.y < -pad;
  }

  /** Return model nodes so existing city, event and route actions keep working. */
  elementsAt(x: number, y: number, scale: number): MapElement[] {
    const hits: MapElement[] = [];
    this.ctx.save(); this.ctx.resetTransform();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.paint.pointer === 'none') continue;
      const p = item.inverse.transformPoint({x, y});
      if (this.hit(item, p.x, p.y, scale)) hits.push(item.node);
    }
    this.ctx.restore();
    return hits;
  }

  /** Include invisible hit discs and text bounds in precise feature picking. */
  private hit(item: Item, x: number, y: number, scale: number): boolean {
    const p = item.paint, mode = p.pointer.toLowerCase(), b = item.bounds;
    if (item.text || mode === 'bounding-box') {
      return !!b && x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;
    }
    if (!item.path) return false;
    const all = mode === 'all' || mode === 'visible';
    const fill = all || mode.includes('fill') || (mode !== 'stroke' && mode !== 'visiblestroke' && p.fill !== 'none');
    const stroke = all || mode.includes('stroke') || (mode !== 'fill' && mode !== 'visiblefill' && p.stroke !== 'none');
    if (fill && this.ctx.isPointInPath(item.path, x, y, p.rule)) return true;
    if (!stroke || !p.width) return false;
    setStrokeStyle(this.ctx, p, scale * Math.hypot(item.matrix.a, item.matrix.b));
    return this.ctx.isPointInStroke(item.path, x, y);
  }

  /** Hover state lives on the feature and invalidates its cartographic paint. */
  setHover(nodes: MapElement[]) {
    const next = new Set<MapElement>();
    const query = ['settlement-node', 'milestone-pin', 'corridor-line', 'province-shape', 'polity-shape', 'prefecture-shape'].map(tag => ({tags: [tag]}));
    for (const node of nodes) {
      const target = node instanceof MapElement ? node.ancestor(query) : null;
      if (target) next.add(target);
    }
    for (const node of this.hovered) if (!next.has(node)) node.tags.remove('is-canvas-hovered');
    for (const node of next) if (!this.hovered.has(node)) node.tags.add('is-canvas-hovered');
    this.canvas.parentElement?.classList.toggle('is-feature-hovered', next.size > 0);
    this.hovered = next;
  }

  /** Typography placement reads current attributes; cached frames may be older. */
  clientRect(node: MapElement): DOMRect {
    const css = styleFor(node, this.context());
    const bounds = node.kind === 'text' ? textBounds(this.ctx, readText(node, css)) : shapeBounds(node);
    if (!bounds) return new DOMRect();
    let matrix = new DOMMatrix();
    for (let el: MapElement | undefined = node; el && el !== this.root; el = el.parent) {
      const style = el === node ? css : styleFor(el, this.context());
      if (style.display === 'none') return new DOMRect();
      matrix = localMatrix(el, style).multiply(matrix);
    }
    const frame = this.frame(), rect = this.viewport();
    return transformBounds(bounds, new DOMMatrix([frame.scale, 0, 0, frame.scale,
      frame.x + rect.left, frame.y + rect.top]).multiply(matrix));
  }

  /** Drop references to removed model nodes when Vue tears down the map. */
  dispose() {
    this.hovered.clear(); this.items = [];
  }
}
