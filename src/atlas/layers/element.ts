import * as L from 'leaflet';

export interface LayerQuery {
  id?: string; kind?: string; tags?: string[]; without?: string[];
  metadata?: Record<string, string | boolean>; within?: LayerQuery;
}
export type LayerValues = Record<string, string | number>;
const camel = (key: string) => key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

/** State changes invalidate the renderer directly, without observing a DOM tree. */
class LayerTags {
  private values = new Set<string>();
  constructor(private changed: () => void) {}
  contains(value: string) { return this.values.has(value); }
  add(...values: string[]) { for (const value of values) this.toggle(value, true); }
  remove(...values: string[]) { for (const value of values) this.toggle(value, false); }
  toggle(value: string, force = !this.contains(value)) {
    if (force === this.contains(value)) return force;
    if (force) this.values.add(value); else this.values.delete(value);
    this.changed(); return force;
  }
  toString() { return [...this.values].join(' '); }
}

/** Every feature is a real Leaflet layer, including compound cartographic markers. */
export class MapElement extends L.LayerGroup {
  readonly kind: string;
  id = '';
  parent?: MapElement;
  readonly tags = new LayerTags(() => this.changed());
  readonly metadata = this.observable({});
  readonly paint = this.observable({});
  readonly geometry: LayerValues = {};
  private ordered: MapElement[] = [];
  private text = '';
  measure?: (node: MapElement) => DOMRect;
  invalidate?: () => void;
  constructor(kind: string, values: LayerValues = {}) {
    super(); this.kind = kind === 'g' ? 'group' : kind;
    for (const [key, value] of Object.entries(values)) this.set(key, value);
  }
  /** Inline state is observable even when callers update a single property. */
  private observable(values: LayerValues): LayerValues {
    return new Proxy(values, {set: (target, key: string, value) => {
      if (target[key] !== value) { target[key] = value; this.changed(); }
      return true;
    }});
  }
  /** Leaflet lifecycle events also invalidate features removed through the map API. */
  override onAdd(map: L.Map): this { super.onAdd(map); this.changed(); return this; }
  override onRemove(map: L.Map): this { super.onRemove(map); this.changed(); return this; }
  get attached() { return !!this._map && this._map.hasLayer(this); }
  get label() { return this.text; }
  set label(value: string) { if (value !== this.text) { this.text = value; this.changed(); } }
  get children() { return this.ordered; }
  get first() { return this.ordered[0]; }
  /** Notify through parent groups, including changes before the layer is mounted. */
  changed() { if (this.parent) this.parent.changed(); else this.invalidate?.(); }
  set(key: string, value: string | number) {
    if (key === 'class') {
      this.tags.remove(...this.tags.toString().split(' '));
      this.tags.add(...String(value).split(/\s+/));
    } else if (key === 'id') this.id = String(value);
    else if (key.startsWith('data-')) this.metadata[camel(key.slice(5))] = String(value);
    else if (this.geometry[key] !== value) { this.geometry[key] = value; this.changed(); }
    return this;
  }
  get(key: string): string | null {
    if (key === 'class') return this.tags.toString();
    if (key === 'id') return this.id;
    const value = key.startsWith('data-') ? this.metadata[camel(key.slice(5))] : this.geometry[key];
    return value === undefined ? null : String(value);
  }
  has(key: string) { return this.get(key) !== null; }
  unset(key: string) { delete this.geometry[key]; this.changed(); }
  /** Preserve explicit paint order while Leaflet handles attachment and removal. */
  override addLayer(layer: MapElement): this {
    if (layer.parent) layer.parent.removeLayer(layer);
    this.ordered.push(layer); layer.parent = this;
    super.addLayer(layer); this.changed(); return this;
  }
  override removeLayer(layer: L.Layer | number): this {
    const child = typeof layer === 'number' ? this.getLayer(layer) : layer;
    this.ordered = this.ordered.filter(item => item !== child);
    if (child instanceof MapElement) child.parent = undefined;
    super.removeLayer(layer); this.changed(); return this;
  }
  override clearLayers(): this {
    for (const child of [...this.ordered]) this.removeLayer(child);
    return this;
  }
  override remove(): this { if (this.parent) this.parent.removeLayer(this); else super.remove(); return this; }
  moveBefore(layer: MapElement, before?: MapElement) {
    this.addLayer(layer); this.ordered.pop();
    const index = before ? this.ordered.indexOf(before) : -1;
    this.ordered.splice(index < 0 ? this.ordered.length : index, 0, layer); this.changed();
  }
  matches(query: LayerQuery): boolean {
    return (!query.id || this.id === query.id) && (!query.kind || this.kind === query.kind) &&
      (!query.tags || query.tags.every(tag => this.tags.contains(tag))) &&
      (!query.without || query.without.every(tag => !this.tags.contains(tag))) &&
      (!query.metadata || Object.entries(query.metadata).every(([key, value]) =>
        value === true ? this.metadata[key] !== undefined : this.metadata[key] === value)) &&
      (!query.within || !!this.parent?.ancestor(query.within));
  }
  ancestor(query: LayerQuery | LayerQuery[]): MapElement | null {
    const queries = Array.isArray(query) ? query : [query];
    if (queries.some(item => this.matches(item))) return this;
    return this.parent?.ancestor(query) || null;
  }
  findAll(query: LayerQuery | LayerQuery[]): MapElement[] {
    const queries = Array.isArray(query) ? query : [query], result: MapElement[] = [];
    for (const child of this.ordered) {
      if (queries.some(item => child.matches(item))) result.push(child);
      result.push(...child.findAll(query));
    }
    return result;
  }
  find(query: LayerQuery | LayerQuery[]) { return this.findAll(query)[0] || null; }
  getScreenBounds(): DOMRect {
    let root: MapElement = this;
    while (root.parent) root = root.parent;
    return root.measure?.(this) || new DOMRect();
  }
}
