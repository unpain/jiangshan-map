import type { MapElement } from '../layers/element';
import type { LayerStyle } from '../layers/style';
export interface Bounds { x: number; y: number; width: number; height: number }
export interface Frame { scale: number; x: number; y: number }

/** Read projected coordinates directly from the Leaflet feature. */
export const number = (node: MapElement, name: string) => Number(node.get(name)) || 0;

/** Compose projected geometry transforms without browser layout. */
export function localMatrix(node: MapElement, style: LayerStyle): DOMMatrix {
  const value = style.transform !== 'none' ? style.transform : node.get('transform') || '';
  let matrix = new DOMMatrix();
  for (const match of value.matchAll(/([a-zA-Z]+)\(([^)]+)\)/g)) {
    const n = (match[2].match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (match[1] === 'translate') matrix = matrix.translate(n[0], n[1] || 0);
    if (match[1] === 'scale') matrix = matrix.scale(n[0], n[1] ?? n[0]);
    if (match[1] === 'rotate') matrix = matrix.translate(n[1] || 0, n[2] || 0).rotate(n[0]).translate(-(n[1] || 0), -(n[2] || 0));
    if (match[1] === 'matrix') matrix = matrix.multiply(new DOMMatrix(n));
  }
  return matrix;
}

/** Transform all corners so rotated labels have conservative screen bounds. */
export function transformBounds(box: Bounds, matrix: DOMMatrix): DOMRect {
  const points = [[box.x, box.y], [box.x + box.width, box.y],
    [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
    .map(([x, y]) => matrix.transformPoint({x, y}));
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return new DOMRect(Math.min(...xs), Math.min(...ys),
    Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** Build reusable paths only when content changes, never on camera frames. */
export function shapePath(node: MapElement): Path2D | undefined {
  const n = (name: string) => number(node, name), path = new Path2D();
  switch (node.kind) {
    case 'path': return node.has('d') ? new Path2D(node.get('d')!) : undefined;
    case 'circle': path.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2); break;
    case 'ellipse': path.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2); break;
    case 'rect': path.roundRect(n('x'), n('y'), n('width'), n('height'), n('rx')); break;
    case 'line': path.moveTo(n('x1'), n('y1')); path.lineTo(n('x2'), n('y2')); break;
    case 'polygon': case 'polyline': return polygonPath(node);
    default: return undefined;
  }
  return path;
}

/** Point coordinates compile into a reusable Canvas path. */
function polygonPath(node: MapElement): Path2D {
  const path = new Path2D(), points = (node.get('points')?.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (i) path.lineTo(points[i], points[i + 1]); else path.moveTo(points[i], points[i + 1]);
  }
  if (node.kind === 'polygon') path.closePath();
  return path;
}

/** Bounds are optional: unknown curves still paint and use precise path hits. */
export function shapeBounds(node: MapElement): Bounds | undefined {
  const n = (name: string) => number(node, name);
  if (node.kind === 'circle' || node.kind === 'ellipse') {
    const rx = n(node.kind === 'circle' ? 'r' : 'rx'), ry = n(node.kind === 'circle' ? 'r' : 'ry');
    return {x: n('cx') - rx, y: n('cy') - ry, width: rx * 2, height: ry * 2};
  }
  if (node.kind === 'rect') return {x: n('x'), y: n('y'), width: n('width'), height: n('height')};
  if (node.kind === 'line') return pointBounds([n('x1'), n('y1'), n('x2'), n('y2')]);
  const data = node.get(node.kind === 'path' ? 'd' : 'points');
  // Only absolute M/L/Q/C/Z commands can be bounded by their coordinate pairs.
  if (!data || (node.kind === 'path' && /[a-zA-Z]/.test(data.replace(/[MLQCZ]/g, '')))) return;
  return pointBounds((data.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(Number));
}

/** Control points bound Bezier curves conservatively, including their extrema. */
function pointBounds(values: number[]): Bounds | undefined {
  if (values.length < 2) return;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i + 1 < values.length; i += 2) {
    x = Math.min(x, values[i]); right = Math.max(right, values[i]);
    y = Math.min(y, values[i + 1]); bottom = Math.max(bottom, values[i + 1]);
  }
  return {x, y, width: right - x, height: bottom - y};
}

const paths = new WeakMap<MapElement, {commands: string; path: Path2D; bounds?: Bounds}>();

/** Hover and visibility changes reuse parsed geographic paths. */
export function pathGeometry(node: MapElement) {
  const commands = node.get('d') || '';
  let geometry = paths.get(node);
  if (!geometry || geometry.commands !== commands) {
    geometry = {commands, path: new Path2D(commands), bounds: shapeBounds(node)};
    paths.set(node, geometry);
  }
  return geometry;
}
