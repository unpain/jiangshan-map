import type { MapElement } from './element';
import { applyCartography } from './cartography';

export type LayerStyle = Record<string, string>;
export interface StyleContext {
  locale: 'zh' | 'en'; width: number; isChallengeAnswered: boolean; hasActivePerson: boolean; hasActiveChallenge: boolean;
  hasActiveJourney: boolean; hasActiveGenealogy: boolean;
}
const defaults: LayerStyle = {
  fill: 'black', stroke: 'none', fillOpacity: '1', strokeOpacity: '1', strokeWidth: '1',
  vectorEffect: 'none', strokeDasharray: 'none', strokeDashoffset: '0', strokeLinejoin: 'miter',
  strokeLinecap: 'butt', fillRule: 'nonzero', paintOrder: 'normal', pointerEvents: 'auto',
  cursor: 'auto', fontFamily: '"LXGW WenKai Mono", monospace', fontStyle: 'normal',
  fontWeight: '400', fontSize: '16px', letterSpacing: '0px', textAnchor: 'start',
  dominantBaseline: 'auto', opacity: '1', visibility: 'visible', display: 'inline',
  transform: 'none', color: '#2b2622',
};
const local = ['opacity', 'display', 'transform', 'vectorEffect'];
const camel = (key: string) => key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

/** Resolve inherited paint from layer options; no browser CSS or DOM is involved. */
export function resolveStyle(node: MapElement, context: StyleContext, parent?: LayerStyle): LayerStyle {
  const style = {...defaults, ...parent};
  for (const key of local) style[key] = defaults[key];
  for (const [key, value] of Object.entries(node.geometry)) {
    const property = camel(key);
    if (property in defaults && property !== 'transform') style[property] = String(value);
  }
  applyCartography(node, context, style);
  for (const [key, value] of Object.entries(node.paint)) if (value !== '') style[key] = String(value);
  applyCartography(node, context, style, true);
  for (const key of ['fill', 'stroke']) if (style[key] === 'currentColor') style[key] = style.color;
  if (style.letterSpacing.endsWith('em')) style.letterSpacing = `${parseFloat(style.letterSpacing) * parseFloat(style.fontSize)}px`;
  return style;
}

/** Measurements may run before a draw; resolve ancestors with the same inheritance. */
export function styleFor(node: MapElement, context: StyleContext): LayerStyle {
  return resolveStyle(node, context, node.parent ? styleFor(node.parent, context) : undefined);
}

/** Share ancestor styles within one rebuild while invalidating them on the next mutation. */
export function styleResolver(context: StyleContext) {
  const cache = new Map<MapElement, LayerStyle>();
  const resolve = (node: MapElement): LayerStyle => {
    let style = cache.get(node);
    if (!style) {
      style = resolveStyle(node, context, node.parent ? resolve(node.parent) : undefined);
      cache.set(node, style);
    }
    return style;
  };
  return resolve;
}
