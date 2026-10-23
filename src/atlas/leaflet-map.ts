import { MapElement } from './layers/element';
import { styleResolver, styleFor, type LayerStyle, type StyleContext } from './layers/style';
import { number, pathGeometry } from './canvas/geometry';
import * as L from 'leaflet';
import type { MapHost, Camera } from './types';
import { GEOGRAPHY, CanvasAnnotations } from './canvas/annotations';

/* Leaflet owns the viewport; dense vector geometry is painted once on Canvas.
 * The atlas's Mercator-projected coordinates are retained via CRS.Simple so
 * existing routes, labels, terrain registration and shared URLs stay exact.
 */

interface Frame { scale: number; x: number; y: number }
interface PaintStyle {
  fill: string; stroke: string; fillOpacity: number; strokeOpacity: number;
  width: number; fixed: boolean; dash: number[]; rule: string; pointer: boolean;
}
interface GeometryRecord {
  node: MapElement; path: Path2D; box: { x: number; y: number; width: number; height: number }; style: PaintStyle;
}

export class LeafletAtlasMap extends L.Layer {
  app: MapHost;
  map: L.Map;
  container: HTMLElement;
  records: Map<MapElement, GeometryRecord>;
  visible: GeometryRecord[] = [];
  canvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  annotationCanvas!: HTMLCanvasElement;
  annotations!: CanvasAnnotations;
  terrain!: HTMLImageElement;
  terrainLayer!: MapElement;

  resizeObserver!: ResizeObserver;
  wheelListener!: (event: WheelEvent) => void;
  private fontListener = () => {
    this.annotationDirty = true;
    this.scheduleAnnotation();
  };
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
  private suspended = false;
  raf = 0;
  coverageRaf = 0;
  commitRaf = 0;
  wheelRaf = 0;
  commitTimer = 0;
  wheelTimer = 0;
  annotationRaf = 0;
  wheelTarget = 0;
  wheelPoint = L.point(0, 0);
  wheelAnchor = L.latLng(0, 0);
  layoutFrame?: Frame;
  canvasFrame?: Frame;
  annotationFrame?: Frame;
  canvasPad = { x: 0, y: 0 };
  canvasCssWidth = 0;
  canvasCssHeight = 0;
  lastPaintTime = 0;
  viewportRect?: DOMRect;

  /** Keep map setup separate from layer attachment so Vue can dispose it cleanly. */
  constructor(app: MapHost) {
    super(); this.app = app; this.records = new Map();
    const container = document.getElementById('leaflet-map');
    if (!container) throw new Error('Missing map container');
    this.container = container;
    this.map = L.map(container, {
      crs: L.CRS.Simple, preferCanvas: true, zoomControl: false,
      attributionControl: false, zoomSnap: 0, zoomDelta: 0.25,
      minZoom: -3, maxZoom: 5, doubleClickZoom: false, keyboard: false,
      zoomAnimation: false, inertia: true, scrollWheelZoom: false,
    });
    this.createSurfaces(); this.loadTerrain(); this.bindCamera(); this.bindInput();
    app.scene.invalidate = () => this.invalidate();
    app.scene.measure = node => this.annotations.clientRect(node);
    app.scene.addTo(this.map); this.addTo(this.map);
    this.map.on('unload', () => this.dispose());
  }

  /** Canvas surfaces belong to this Leaflet layer, not to the Vue template. */
  private createSurfaces() {
    this.canvas = L.DomUtil.create('canvas', 'atlas-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.annotationCanvas = L.DomUtil.create('canvas', 'atlas-annotations');
    this.annotationCanvas.setAttribute('aria-hidden', 'true');
    this.annotations = new CanvasAnnotations(this.app.scene, this.annotationCanvas,
      () => this.frame(), () => this.container.getBoundingClientRect(), () => this.styleContext());
    document.fonts.addEventListener('loadingdone', this.fontListener);
  }

  /** Terrain loading can finish after navigation or teardown. */
  private loadTerrain() {
    this.terrainLayer = this.app.scene.find({id: 'terrain-relief'})!;
    this.terrain = new Image();
    this.terrain.onload = () => { if (!this.disposed) this.schedule(); };
    this.terrain.src = this.terrainLayer.get('src')!;
  }

  /** Leaflet is the only source of gesture and camera state. */
  private bindCamera() {
    this.map.on('move', () => this.readCamera());
    this.map.on('moveend zoomend', () => { if (!this.syncing) this.deferCommit(); });
    this.map.on('resize', () => { this.stopWheel(); this.readCamera(); this.commit(true); });
    this.map.on('dragstart', () => { this.stopWheel(); this.dragging = true; });
    this.map.on('dragend', () => { this.dragging = false; this.deferCommit(); });
    this.map.on('dragstart zoomstart', () => this.beginGesture());
    this.map.on('zoomend', () => { if (!this.syncing) this.app.lastPinchTime = Date.now(); });
  }

  /** Interrupt camera playback as soon as the user takes control. */
  private beginGesture() {
    if (this.syncing) return;
    if (!this.moving) this.app._recordGestureMove();
    this.beginMove(); this.app.didPan = true;
    if (this.app.flyRaf) { cancelAnimationFrame(this.app.flyRaf); this.app.flyRaf = 0; }
  }

  /** Wheel interpolation and context actions share Leaflet's coordinate conversion. */
  private bindInput() {
    this.map.on('contextmenu', event => {
      if (this.app.challenge) return;
      const [lng, lat] = this.app.projector.toGeo(event.latlng.lng, -event.latlng.lat);
      this.app.openGenealogyAt(lng, lat);
    });
    this.wheelListener = event => this.onWheel(event);
    this.container.addEventListener('wheel', this.wheelListener, {passive: false});
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(this.container);
  }

  /** Release async work and feature references before Vue remounts the atlas. */
  private dispose() {
    this.disposed = true; this.terrain.onload = null;
    this.app.scene.invalidate = undefined; this.app.scene.measure = undefined;
    this.resizeObserver.disconnect();
    for (const id of [this.raf, this.coverageRaf, this.commitRaf, this.annotationRaf, this.wheelRaf]) cancelAnimationFrame(id);
    clearTimeout(this.commitTimer); clearTimeout(this.wheelTimer);
    this.annotations.dispose(); this.records.clear(); this.visible = [];
    this.container.removeEventListener('wheel', this.wheelListener);
    document.fonts.removeEventListener('loadingdone', this.fontListener);
    this.annotationCanvas.remove(); this.canvas.remove();
  }

  /** Attach surfaces through Leaflet, so removing the layer also removes its pixels. */
  override onAdd(_map: L.Map): this {
    this.suspended = false;
    this.container.append(this.canvas, this.annotationCanvas);
    this.invalidate();
    return this;
  }

  override onRemove(_map: L.Map): this {
    this.suspended = true;
    this.canvas.remove(); this.annotationCanvas.remove();
    return this;
  }

  /** Data mutations explicitly invalidate both display lists. */
  invalidate() {
    this.dirty = true; this.annotationDirty = true;
    if (this.committing) return;
    this.schedule(); this.scheduleAnnotation();
    this.container.classList.toggle('is-crosshair', this.app.scene.tags.contains('is-crosshair'));
  }

  styleContext(): StyleContext {
    return {locale: this.app.locale, width: window.innerWidth, isChallengeAnswered: !!(this.app.challenge as {answered?: boolean})?.answered, hasActivePerson: !!this.app.activePerson,
      hasActiveChallenge: !!this.app.challenge, hasActiveJourney: !!this.app.activeCustomRoute,
      hasActiveGenealogy: !!this.app.activeTrace};
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
    this.annotations.setHover([]);
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.map.getSize().y : 1);
    if (!delta) return;
    if (!this.wheelActive) {
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

  /** Coalesce content and camera updates into one live annotation paint. */
  scheduleAnnotation() {
    if (this.annotationRaf || !this.loaded || this.disposed || this.suspended) return;
    this.annotationRaf = requestAnimationFrame(() => {
      this.annotationRaf = 0;
      this.drawAnnotations();
    });
  }

  /** Keep layout and pixels on the same zoom frame without map DOM measurements. */
  drawAnnotations() {
    if (!this.loaded || this.disposed || this.suspended) return;
    const current = this.frame();
    const relayout = this.updateLayout(current);
    if (this.annotationDirty) {
      this.annotations.rebuild();
      this.annotationDirty = false;
    }
    const size = this.map.getSize();
    this.annotationFrame = current;
    if (relayout) this.draw(false);
    this.transformGeography(this.annotationFrame);
    this.annotations.draw(this.annotationFrame, size.x, size.y);
    this.annotationReady = true;
  }

  /** Reflow labels in the same animation frame as zooming, while pans reuse layout. */
  private updateLayout(current: Frame, force = false) {
    if (!force && !this.app._typoDirty && this.layoutFrame &&
        Math.abs(current.scale - this.layoutFrame.scale) < 1e-10) return false;
    this.committing = true;
    try {
      this.app._applyCamera(true);
      this.layoutFrame = current;
    } finally { this.committing = false; }
    this.annotationDirty = true;
    return true;
  }

  // Camera playback and pointer gestures share the same live layout path.
  applyCamera(force: boolean) {
    this.stopWheel();
    this.setCamera(this.app.camera);
    if (!this.layoutFrame || force) { this.commit(force); return; }
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
    if (!this.layoutFrame) return;
    const current = this.frame();
    this.scheduleAnnotation();
    // Refill only when a long drag/large zoom exhausts the cached margin.
    // Geography stays composited on ordinary frames. Rate-limit coverage refills.
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

  /** Composite geography in the same frame as labels to avoid a one-frame drift. */
  private transformGeography(current: Frame) {
    if (!this.canvasFrame) return;
    const scale = current.scale / this.canvasFrame.scale;
    const x = current.x - (this.canvasFrame.x + this.canvasPad.x) * scale;
    const y = current.y - (this.canvasFrame.y + this.canvasPad.y) * scale;
    this.canvas.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
  }

  deferCommit() {
    clearTimeout(this.commitTimer);
    cancelAnimationFrame(this.commitRaf);
    this.commitRaf = 0;
    if (this.dragging || this.wheelActive || this.wheelRaf) return;
    this.commitTimer = window.setTimeout(() => {
      // A delayed animation frame may already contain a newer camera update.
      // Give it a chance to cancel idle cleanup if the gesture resumes.
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
    this.app.milestoneBalloon.style.visibility = '';
    this.container.classList.remove('is-map-moving');
    const current = this.frame();
    this.updateLayout(current, force);
    this.app._updateScaleBar();
    if (this.app.activeMilestone) this.app._positionMilestoneBalloon();
    this.transformLayers();
    this.scheduleAnnotation();
    if (force || this.dirty || !this.canvasFrame ||
        Math.abs(current.scale - this.canvasFrame.scale) > 0.00001) this.schedule();
  }

  schedule() {
    if (this.raf || this.disposed || this.suspended) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.moving) this.draw();
    });
  }

  /** Rebuild geography in layer order, retaining geometry on the Leaflet feature itself. */
  refreshStyles() {
    this.visible = []; this.records.clear();
    const styleOf = styleResolver(this.styleContext());
    for (const node of this.app.scene.findAll({kind: 'path'})) {
      if (!node.attached || !node.ancestor(GEOGRAPHY) || !node.has('d')) continue;
      let opacity = 1, hidden = false;
      for (let el: MapElement | undefined = node; el; el = el.parent) {
        const css = styleOf(el);
        if (css.display === 'none' || css.visibility === 'hidden') { hidden = true; break; }
        opacity *= Number(css.opacity);
      }
      if (hidden) continue;
      this.addGeography(node, styleOf(node), opacity);
    }
    this.dirty = false;
  }

  /** Preserve geographic stroke widths in screen pixels under zoom. */
  private addGeography(node: MapElement, css: LayerStyle, opacity: number) {
    const geometry = pathGeometry(node), box = geometry.bounds;
    if (!box) return;
    const rec = {node, path: geometry.path, box, style: {
      fill: css.fill, stroke: css.stroke, fillOpacity: Number(css.fillOpacity) * opacity,
      strokeOpacity: Number(css.strokeOpacity) * opacity, width: parseFloat(css.strokeWidth) || 0,
      fixed: css.vectorEffect === 'non-scaling-stroke',
      dash: css.strokeDasharray === 'none' ? [] : css.strokeDasharray.split(/[ ,]+/).map(parseFloat),
      rule: css.fillRule, pointer: css.pointerEvents !== 'none'}};
    this.records.set(node, rec); this.visible.push(rec);
  }

  draw(overscan = true) {
    if (!this.loaded || this.disposed || this.suspended) return;
    if (this.dirty) this.refreshStyles();
    const size = this.map.getSize(), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    // Pans need a cached margin; live zoom paints only the visible viewport.
    const margin = overscan ? 0.25 : 0;
    const pad = L.point(size.x * margin, size.y * margin);
    const width = size.x + pad.x * 2, height = size.y + pad.y * 2, dpr = Math.min(2, window.devicePixelRatio || 1);
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
    this.drawTerrain();
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
    // A coverage refill can run after a camera callback in the same frame.
    // Keep it aligned with the last painted labels until their next live draw.
    this.transformGeography(this.annotationFrame || this.canvasFrame);
  }

  /** Raster terrain participates in the same Leaflet lifecycle as vector features. */
  private drawTerrain() {
    const layer = this.terrainLayer;
    if (!layer.attached || !this.app.terrainMode || !this.terrain.complete || !this.terrain.naturalWidth) return;
    const paint = styleFor(layer, this.styleContext());
    if (paint.display === 'none') return;
    this.ctx.globalAlpha = Number(paint.opacity);
    this.ctx.drawImage(this.terrain, number(layer, 'x'), number(layer, 'y'),
      number(layer, 'width'), number(layer, 'height'));
  }

  elementsFromPoint(x: number, y: number) {
    const stack = document.elementsFromPoint(x, y);
    if (stack[0] && !this.container.contains(stack[0])) return [];
    const rect = this.container.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return stack;
    if (this.dirty) this.refreshStyles();
    const [px, py] = this.app._clientToMapPoint(x, y);
    if (this.annotationDirty) this.drawAnnotations();
    const hits = this.annotations.elementsAt(px, py, this.frame().scale);
    const ctx = this.ctx;
    ctx.save(); ctx.resetTransform();
    for (let i = (this.visible || []).length - 1; i >= 0; i--) {
      const rec = this.visible[i], b = rec.box;
      if (!rec.style.pointer || px < b.x || px > b.x + b.width || py < b.y || py > b.y + b.height) continue;
      if (ctx.isPointInPath(rec.path, px, py, rec.style.rule === 'evenodd' ? 'evenodd' : 'nonzero')) hits.push(rec.node);
    }
    ctx.restore();
    return hits;
  }
}
