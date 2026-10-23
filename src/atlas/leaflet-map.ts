import * as L from 'leaflet';
import type { MapHost, Camera } from './types';

/* Leaflet owns the viewport; dense vector geometry is painted once on Canvas.
 * The atlas's Mercator-projected coordinates are retained via CRS.Simple so
 * existing routes, labels, terrain registration and shared URLs stay exact.
 */
const GROUPS = '#grp-neighbors, #grp-provinces, #grp-polities, #grp-prefectures, #grp-rivers, #grp-ghost-diff';


interface Frame { scale: number; x: number; y: number }
interface PaintStyle {
  fill: string; stroke: string; fillOpacity: number; strokeOpacity: number;
  width: number; fixed: boolean; dash: number[]; rule: string; pointer: boolean;
}
interface GeometryRecord {
  node: Element; path: Path2D; box: { x: number; y: number; width: number; height: number }; style: PaintStyle;
}
const emptyStyle: PaintStyle = { fill: 'none', stroke: 'none', fillOpacity: 0, strokeOpacity: 0, width: 0, fixed: false, dash: [], rule: 'nonzero', pointer: false };

export class LeafletAtlasMap {
  app: MapHost;
  map: L.Map;
  container: HTMLElement;
  records: Map<Element, GeometryRecord>;
  visible: GeometryRecord[] = [];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  annotationCanvas: HTMLCanvasElement;
  terrain: HTMLImageElement;
  observer: MutationObserver;
  resizeObserver: ResizeObserver;
  wheelListener: (event: WheelEvent) => void;
  dirty = true;
  annotationDirty = true;
  annotationReady = false;
  syncing = false;
  dragging = false;
  moving = false;
  committing = false;
  wheelActive = false;
  private loaded = false;
  private disposed = false;
  raf = 0;
  coverageRaf = 0;
  commitRaf = 0;
  wheelRaf = 0;
  commitTimer = 0;
  wheelTimer = 0;
  annotationTimer = 0;
  wheelTarget = 0;
  wheelPoint = L.point(0, 0);
  wheelAnchor = L.latLng(0, 0);
  svgFrame?: Frame;
  canvasFrame?: Frame;
  annotationFrame?: Frame;
  annotationPad = { x: 0, y: 0 };
  canvasPad = { x: 0, y: 0 };
  canvasCssWidth = 0;
  canvasCssHeight = 0;
  lastPaintTime = 0;
  viewportRect?: DOMRect;

  constructor(app: MapHost) {
    this.app = app;
    this.records = new Map();
    this.dirty = true;
    const container = document.getElementById('leaflet-map');
    if (!container) throw new Error('Missing map container');
    this.container = container;
    this.map = L.map(this.container, {
      crs: L.CRS.Simple, preferCanvas: true, zoomControl: false,
      attributionControl: false, zoomSnap: 0, zoomDelta: 0.25,
      minZoom: -3, maxZoom: 5, doubleClickZoom: false, keyboard: false,
      zoomAnimation: false, inertia: true, scrollWheelZoom: false,
    });
    // Keep the small interactive SVG above the Canvas, inside Leaflet's
    // event surface so drag, wheel, keyboard and pinch use one controller.
    this.container.appendChild(app.svg);
    this.canvas = L.DomUtil.create('canvas', 'atlas-canvas', this.container);
    this.ctx = this.canvas.getContext('2d')!;
    this.annotationCanvas = L.DomUtil.create('canvas', 'atlas-annotation-cache', this.container);
    this.annotationCanvas.setAttribute('aria-hidden', 'true');
    this.annotationDirty = true;
    this.terrain = new Image();
    this.terrain.onload = () => { if (!this.disposed) this.schedule(); };
    this.terrain.src = 'assets/terrain_relief.webp';
    this.map.on('move', () => this.readCamera());
    this.map.on('moveend zoomend', () => { if (!this.syncing) this.deferCommit(); });
    this.map.on('resize', () => { this.stopWheel(); this.readCamera(); this.commit(true); });
    this.map.on('dragstart', () => { this.stopWheel(); this.dragging = true; });
    this.map.on('dragend', () => { this.dragging = false; this.deferCommit(); });
    this.map.on('dragstart zoomstart', () => {
      if (this.syncing) return;
      if (!this.moving) app._recordGestureMove();
      this.beginMove();
      app.didPan = true;
      if (app.flyRaf) { cancelAnimationFrame(app.flyRaf); app.flyRaf = 0; }
    });
    this.map.on('zoomend', () => { if (!this.syncing) app.lastPinchTime = Date.now(); });
    this.map.on('contextmenu', (event) => {
      if (app.challenge) return;
      const [lng, lat] = app.projector.toGeo(event.latlng.lng, -event.latlng.lat);
      app.openGenealogyAt(lng, lat);
    });
    this.observer = new MutationObserver((records) => {
      const changes = records.filter((record): record is MutationRecord & { target: Element } => record.target instanceof Element);
      if (records.some(record => record.type === 'characterData')) {
        this.annotationDirty = true;
        this.scheduleAnnotation();
      }
      if (changes.some(({target, attributeName, oldValue, type}) =>
        !(target === app.svg && attributeName === 'style') &&
        (type !== 'attributes' || target.getAttribute(attributeName || '') !== oldValue))) {
        this.annotationDirty = true;
        this.scheduleAnnotation();
      }
      if (!changes.some(({target, type, attributeName, oldValue}) => {
        if (type === 'attributes' && target.getAttribute(attributeName || '') === oldValue) return false;
        // Compositor transforms do not change geographic paint styles.
        if (target === app.svg && attributeName === 'style') return false;
        if (target.nodeType !== 1) return false;
        return type === 'childList' || target === app.svg || target.id === 'grp-terrain' ||
          target.matches(GROUPS) || this.records.has(target) ||
          (target.tagName === 'g' && target.closest(GROUPS));
      })) return;
      this.dirty = true;
      this.schedule();
    });
    this.observer.observe(app.svg, { subtree: true, childList: true, attributes: true,
      attributeOldValue: true, characterData: true });
    this.wheelListener = event => this.onWheel(event);
    this.container.addEventListener('wheel', this.wheelListener, {passive: false});
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(this.container);
    this.map.on('unload', () => {
      this.disposed = true;
      this.terrain.onload = null;
      this.observer.disconnect();
      this.resizeObserver.disconnect();
      cancelAnimationFrame(this.raf);
      cancelAnimationFrame(this.coverageRaf);
      cancelAnimationFrame(this.commitRaf);
      clearTimeout(this.commitTimer);
      clearTimeout(this.wheelTimer);
      clearTimeout(this.annotationTimer);
      cancelAnimationFrame(this.wheelRaf);
      this.container.removeEventListener('wheel', this.wheelListener);
      this.annotationCanvas.remove();
      this.canvas.remove();
      this.records.clear();
    });
  }

  capture(node: Element) {
    if (node.tagName !== 'path' || !node.closest(GROUPS)) return;
    const d = node.getAttribute('d');
    if (!d) return;
    // Projected atlas paths use M/L/Q/C/Z. Control points conservatively
    // bound curves too. Avoid getBBox() forcing layout for every inserted path.
    const values = (d.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (let i = 0; i < values.length; i += 2) {
      x = Math.min(x, values[i]); right = Math.max(right, values[i]);
      y = Math.min(y, values[i + 1]); bottom = Math.max(bottom, values[i + 1]);
    }
    const box = {x, y, width: right - x, height: bottom - y};
    this.records.set(node, { node, path: new Path2D(d), box, style: emptyStyle });
    // Retain only metadata for existing search, focus and tooltip logic.
    node.removeAttribute('d');
    node.getBoundingClientRect = () => {
      const r = this.container.getBoundingClientRect();
      const p = this.map.latLngToContainerPoint([-box.y, box.x]);
      const scale = this.map.getZoomScale(this.map.getZoom(), 0);
      return new DOMRect(r.left + p.x, r.top + p.y, box.width * scale, box.height * scale);
    };
    this.dirty = true;
    this.schedule();
  }

  setCamera(camera: Camera) {
    const size = this.map.getSize();
    if (!size.x || !size.y) return;
    const scale = Math.min(size.x / camera.w, size.y / camera.h);
    this.syncing = true;
    this.loaded = true;
    this.map.setView([-(camera.y + camera.h / 2), camera.x + camera.w / 2], Math.log2(scale), {animate: false});
    this.syncing = false;
  }

  readCamera() {
    if (this.syncing) return;
    const size = this.map.getSize();
    const center = this.map.getCenter();
    const scale = this.map.getZoomScale(this.map.getZoom(), 0);
    const w = size.x / scale, h = size.y / scale;
    this.app.camera = {x: center.lng - w / 2, y: -center.lat - h / 2, w, h, zoom: 1000 / w};
    this.transformLayers();
    this.deferCommit();
  }

  beginMove() {
    clearTimeout(this.commitTimer);
    cancelAnimationFrame(this.commitRaf);
    this.commitRaf = 0;
    if (this.moving) return;
    this.moving = true;
    this.container.classList.add('is-map-moving');
    this.app.hoverTip.classList.add('is-hidden');
    this.app.milestoneBalloon.style.visibility = 'hidden';
    if (this.annotationReady) {
      this.annotationCanvas.style.display = 'block';
      this.app.svg.style.display = 'none';
    }
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.map.getSize().y : 1);
    if (!delta) return;
    if (!this.wheelActive) {
      if (this.annotationDirty && !this.moving) this.cacheAnnotations();
      this.wheelTarget = this.map.getZoom();
      this.app._recordGestureMove();
      if (this.app.flyRaf) { cancelAnimationFrame(this.app.flyRaf); this.app.flyRaf = 0; }
    }
    this.wheelActive = true;
    this.beginMove();
    this.app.didPan = true;
    this.wheelPoint = this.map.mouseEventToContainerPoint(event);
    this.wheelAnchor = this.map.containerPointToLatLng(this.wheelPoint);
    this.wheelTarget = Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(),
      this.wheelTarget - Math.max(-240, Math.min(240, delta)) / 360));
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.wheelActive = false;
      if (!this.wheelRaf) this.deferCommit();
    }, 350);
    if (this.wheelRaf) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last); last = now;
      const zoom = this.map.getZoom();
      const next = Math.abs(this.wheelTarget - zoom) < 0.001 ? this.wheelTarget :
        zoom + (this.wheelTarget - zoom) * (1 - Math.exp(-dt / 55));
      const size = this.map.getSize(), scale = 2 ** next;
      const center: L.LatLngTuple = [this.wheelAnchor.lat + (this.wheelPoint.y - size.y / 2) / scale,
        this.wheelAnchor.lng - (this.wheelPoint.x - size.x / 2) / scale];
      this.map.setView(center, next, {animate: false});
      if (Math.abs(this.wheelTarget - next) > 0.0001) this.wheelRaf = requestAnimationFrame(step);
      else { this.wheelRaf = 0; if (!this.wheelActive) this.deferCommit(); }
    };
    this.wheelRaf = requestAnimationFrame(step);
  }

  stopWheel() {
    cancelAnimationFrame(this.wheelRaf);
    clearTimeout(this.wheelTimer);
    this.wheelRaf = 0;
    this.wheelActive = false;
  }

  scheduleAnnotation() {
    clearTimeout(this.annotationTimer);
    if (this.moving) return;
    this.annotationTimer = window.setTimeout(() => this.cacheAnnotations(), 80);
  }

  cacheAnnotations() {
    if (this.moving || !this.annotationDirty || !this.svgFrame) return;
    const size = this.map.getSize(), frame = this.frame();
    const pad = {x: size.x / 4, y: size.y / 4};
    const width = size.x * 1.5, height = size.y * 1.5;
    const canvas = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
    const ctx = canvas.getContext('2d')!;
    // Paint the existing annotation tree directly: no SVG serialization,
    // image decoding, external fonts or second SVG document layout.
    const visit = (node: Element, matrix: DOMMatrix, opacity: number): void => {
      if (node.id === 'grp-terrain' || node.id === 'ocean-bg' || node.tagName === 'defs') return;
      if (node.tagName === 'path' && !node.hasAttribute('d')) return;
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden') return;
      opacity *= Number(css.opacity);
      if (!opacity) return;
      if (node !== this.app.svg && css.transform !== 'none') matrix = matrix.multiply(new DOMMatrix(css.transform));
      if (node.tagName === 'g' || node === this.app.svg) {
        for (const child of node.children) visit(child, matrix, opacity);
        return;
      }
      ctx.setTransform(matrix.a * dpr, matrix.b * dpr, matrix.c * dpr, matrix.d * dpr, matrix.e * dpr, matrix.f * dpr);
      ctx.fillStyle = css.fill === 'none' ? 'transparent' : css.fill;
      ctx.strokeStyle = css.stroke === 'none' ? 'transparent' : css.stroke;
      const unit = css.vectorEffect === 'non-scaling-stroke' ? 1 / Math.hypot(matrix.a, matrix.b) : 1;
      ctx.lineWidth = (parseFloat(css.strokeWidth) || 0) * unit;
      ctx.lineJoin = css.strokeLinejoin as CanvasLineJoin; ctx.lineCap = css.strokeLinecap as CanvasLineCap;
      ctx.setLineDash(css.strokeDasharray === 'none' ? [] : css.strokeDasharray.split(/[ ,]+/).map(v => parseFloat(v) * unit));
      const number = (name: string) => Number(node.getAttribute(name)) || 0;
      let path;
      switch (node.tagName) {
        case 'text': {
          ctx.font = css.fontStyle + ' ' + css.fontWeight + ' ' + css.fontSize + ' ' + css.fontFamily;
          ctx.textAlign = css.textAnchor === 'middle' ? 'center' : css.textAnchor === 'end' ? 'right' : 'left';
          ctx.textBaseline = /central|middle/.test(css.dominantBaseline) ? 'middle' : 'alphabetic';
          ctx.letterSpacing = css.letterSpacing === 'normal' ? '0px' : css.letterSpacing;
          const x = number('x'), y = number('y');
          if (css.stroke !== 'none') { ctx.globalAlpha = opacity * Number(css.strokeOpacity); ctx.strokeText(node.textContent || '', x, y); }
          if (css.fill !== 'none') { ctx.globalAlpha = opacity * Number(css.fillOpacity); ctx.fillText(node.textContent || '', x, y); }
          return;
        }
        case 'path': path = new Path2D(node.getAttribute('d') || ''); break;
        case 'circle': path = new Path2D(); path.arc(number('cx'), number('cy'), number('r'), 0, Math.PI * 2); break;
        case 'ellipse': path = new Path2D(); path.ellipse(number('cx'), number('cy'), number('rx'), number('ry'), 0, 0, Math.PI * 2); break;
        case 'rect': path = new Path2D(); path.roundRect(number('x'), number('y'), number('width'), number('height'), number('rx')); break;
        case 'line': path = new Path2D(); path.moveTo(number('x1'), number('y1')); path.lineTo(number('x2'), number('y2')); break;
        case 'polygon': case 'polyline': {
          path = new Path2D(); const points = (node as SVGPolygonElement | SVGPolylineElement).points;
          for (let i = 0; i < points.numberOfItems; i++) { const p = points.getItem(i); if (i) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y); }
          if (node.tagName === 'polygon') path.closePath(); break;
        }
        default: return;
      }
      if (css.fill !== 'none') { ctx.globalAlpha = opacity * Number(css.fillOpacity); ctx.fill(path, css.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
      if (css.stroke !== 'none') { ctx.globalAlpha = opacity * Number(css.strokeOpacity); ctx.stroke(path); }
    };
    visit(this.app.svg, new DOMMatrix([frame.scale, 0, 0, frame.scale, frame.x + pad.x, frame.y + pad.y]), 1);
    this.annotationCanvas.width = canvas.width; this.annotationCanvas.height = canvas.height;
    this.annotationCanvas.getContext('2d')!.drawImage(canvas, 0, 0);
    this.annotationCanvas.style.width = width + 'px'; this.annotationCanvas.style.height = height + 'px';
    this.annotationCanvas.style.transform = `translate3d(${-pad.x}px,${-pad.y}px,0)`;
    this.annotationFrame = frame;
    this.annotationPad = pad;
    this.annotationReady = true;
    this.annotationDirty = false;
  }

  // During interaction change only compositor transforms. Never mutate the
  // SVG viewBox, run label placement, or read layout after writing labels.
  applyCamera(force: boolean) {
    this.stopWheel();
    if (this.annotationDirty && !this.moving && this.svgFrame) this.cacheAnnotations();
    this.setCamera(this.app.camera);
    if (!this.svgFrame || force) { this.commit(force); return; }
    this.beginMove();
    this.transformLayers();
    this.deferCommit();
  }

  frame() {
    const size = this.map.getSize();
    const scale = this.map.getZoomScale(this.map.getZoom(), 0);
    const center = this.map.getCenter();
    return { scale, x: size.x / 2 - center.lng * scale, y: size.y / 2 + center.lat * scale };
  }

  transformLayers() {
    if (!this.svgFrame) return;
    const current = this.frame();
    const transform = (element: HTMLElement | SVGSVGElement, reference: Frame | undefined, pad = {x: 0, y: 0}) => {
      if (!reference) return;
      const scale = current.scale / reference.scale;
      const x = current.x - (reference.x + pad.x) * scale;
      const y = current.y - (reference.y + pad.y) * scale;
      element.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    };
    if (this.annotationReady && this.moving) transform(this.annotationCanvas, this.annotationFrame, this.annotationPad);
    else transform(this.app.svg, this.svgFrame);
    transform(this.canvas, this.canvasFrame, this.canvasPad);
    // Refill only when a long drag/large zoom exhausts the cached margin.
    // Ordinary gesture frames never repaint. Rate-limit coverage refills.
    if (this.canvasFrame && !this.coverageRaf && performance.now() - this.lastPaintTime > 120) {
      const ratio = current.scale / this.canvasFrame.scale;
      const left = current.x - (this.canvasFrame.x + this.canvasPad.x) * ratio;
      const top = current.y - (this.canvasFrame.y + this.canvasPad.y) * ratio;
      const size = this.map.getSize();
      if (left > 0 || top > 0 || left + this.canvasCssWidth * ratio < size.x ||
          top + this.canvasCssHeight * ratio < size.y) {
        this.coverageRaf = requestAnimationFrame(() => { this.coverageRaf = 0; this.draw(); });
      }
    }
  }

  deferCommit() {
    clearTimeout(this.commitTimer);
    cancelAnimationFrame(this.commitRaf);
    this.commitRaf = 0;
    if (this.dragging || this.wheelActive || this.wheelRaf) return;
    this.commitTimer = window.setTimeout(() => {
      // A delayed animation frame may already contain a newer camera update.
      // Give it a chance to cancel this commit instead of relaying out mid-gesture.
      this.commitRaf = requestAnimationFrame(() => { this.commitRaf = 0; this.commit(); });
    }, 140);
  }

  commit(force = false) {
    if (!this.loaded) return;
    clearTimeout(this.commitTimer);
    cancelAnimationFrame(this.commitRaf);
    this.commitRaf = 0;
    this.moving = false;
    this.viewportRect = this.container.getBoundingClientRect();
    this.annotationCanvas.style.display = 'none';
    this.app.svg.style.display = '';
    this.app.milestoneBalloon.style.visibility = '';
    this.container.classList.remove('is-map-moving');
    const current = this.frame();
    const rebaseSvg = force || !this.svgFrame || this.app._typoDirty ||
      Math.abs(current.scale - this.svgFrame.scale) > 0.00001;
    this.committing = true;
    try {
      if (rebaseSvg) {
        this.app.svg.style.transform = '';
        this.app._applyCamera(force);
        this.svgFrame = current;
      } else {
        // Pure pans do not change label scale. Keep the composited SVG rather
        // than invalidating all its text paint again at the end of every drag.
        this.app._updateScaleBar();
        if (this.app.activeMilestone) this.app._positionMilestoneBalloon();
      }
    } finally { this.committing = false; }
    this.transformLayers();
    const size = this.map.getSize();
    const cached = this.annotationFrame;
    const ratio = cached ? current.scale / cached.scale : 1;
    const left = cached ? current.x - (cached.x + this.annotationPad.x) * ratio : 1;
    const top = cached ? current.y - (cached.y + this.annotationPad.y) * ratio : 1;
    if (rebaseSvg || !cached || left > 0 || top > 0 ||
        left + parseFloat(this.annotationCanvas.style.width) * ratio < size.x ||
        top + parseFloat(this.annotationCanvas.style.height) * ratio < size.y) this.annotationDirty = true;
    if (this.annotationDirty) this.scheduleAnnotation();
    if (force || this.dirty || !this.canvasFrame ||
        Math.abs(current.scale - this.canvasFrame.scale) > 0.00001) this.schedule();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.moving) this.draw();
    });
  }

  refreshStyles() {
    this.visible = [];
    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (element: Element): CSSStyleDeclaration => {
      if (!styles.has(element)) styles.set(element, getComputedStyle(element));
      return styles.get(element)!;
    };
    for (const [node, rec] of this.records) {
      if (!node.isConnected) { this.records.delete(node); continue; }
      let opacity = 1, hidden = false;
      for (let el: Element | null = node; el && el !== this.container; el = el.parentElement) {
        const css = styleOf(el);
        if ((el !== this.app.svg && css.display === 'none') || css.visibility === 'hidden') { hidden = true; break; }
        // Ignore transient SVG enter animations; Canvas has no CSS animation timeline.
        if (el !== this.app.svg && !el.classList.contains('fade-enter')) opacity *= Number(css.opacity);
      }
      if (hidden) continue;
      const css = styleOf(node);
      rec.style = {fill: css.fill, stroke: css.stroke,
        fillOpacity: Number(css.fillOpacity) * opacity,
        strokeOpacity: Number(css.strokeOpacity) * opacity,
        width: parseFloat(css.strokeWidth) || 0,
        fixed: css.vectorEffect === 'non-scaling-stroke',
        dash: css.strokeDasharray === 'none' ? [] : css.strokeDasharray.split(/[ ,]+/).map(parseFloat),
        rule: css.fillRule, pointer: css.pointerEvents !== 'none'};
      this.visible.push(rec);
    }
    this.visible.sort((a, b) => a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    this.dirty = false;
  }

  draw() {
    if (!this.loaded) return;
    if (this.dirty) this.refreshStyles();
    const size = this.map.getSize(), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    // Overscan allows Leaflet's compositor to pan without repainting geometry.
    const pad = L.point(size.x / 4, size.y / 4);
    const width = size.x * 1.5, height = size.y * 1.5, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvasCssWidth = width; this.canvasCssHeight = height;
    this.lastPaintTime = performance.now();
    const pixelWidth = Math.ceil(width * dpr), pixelHeight = Math.ceil(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
    } else {
      this.ctx.resetTransform(); this.ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    }
    this.canvas.style.width = width + 'px'; this.canvas.style.height = height + 'px';
    this.canvasFrame = this.frame();
    this.canvasPad = pad;
    const origin = L.point(this.canvasFrame.x, this.canvasFrame.y).add(pad);
    this.canvas.style.transform = `translate3d(${-pad.x}px,${-pad.y}px,0)`;
    const ctx = this.ctx;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * origin.x, dpr * origin.y);
    if (this.app.terrainMode && this.terrain.complete && this.terrain.naturalWidth) {
      ctx.globalAlpha = 0.48;
      ctx.drawImage(this.terrain, -80, -40, 1160, 780);
    }
    for (const rec of this.visible || []) {
      const b = rec.box;
      if (b.x * scale + origin.x > width || (b.x + b.width) * scale + origin.x < 0 ||
          b.y * scale + origin.y > height || (b.y + b.height) * scale + origin.y < 0) continue;
      const s = rec.style;
      if (s.fill !== 'none' && s.fillOpacity) {
        ctx.globalAlpha = s.fillOpacity; ctx.fillStyle = s.fill;
        ctx.fill(rec.path, s.rule === 'evenodd' ? 'evenodd' : 'nonzero');
      }
      if (s.stroke !== 'none' && s.strokeOpacity && s.width) {
        const unit = s.fixed ? 1 / scale : 1;
        ctx.globalAlpha = s.strokeOpacity; ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width * unit; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.setLineDash(s.dash.map(v => v * unit)); ctx.stroke(rec.path);
      }
    }
  }

  elementsFromPoint(x: number, y: number) {
    const stack = document.elementsFromPoint(x, y);
    if (stack[0] && !this.container.contains(stack[0])) return stack;
    const rect = this.container.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return stack;
    if (this.dirty) this.refreshStyles();
    const [px, py] = this.app._clientToSvgPoint(x, y);
    const ctx = this.ctx;
    ctx.save(); ctx.resetTransform();
    for (let i = (this.visible || []).length - 1; i >= 0; i--) {
      const rec = this.visible[i], b = rec.box;
      if (!rec.style.pointer || px < b.x || px > b.x + b.width || py < b.y || py > b.y + b.height) continue;
      if (ctx.isPointInPath(rec.path, px, py, rec.style.rule === 'evenodd' ? 'evenodd' : 'nonzero')) stack.push(rec.node);
    }
    ctx.restore();
    return stack;
  }
}
