import type { MapElement } from './element';
import type { LayerStyle, StyleContext } from './style';

export interface PaintRule {
  key: string; order: number; important: boolean;
  when: (node: MapElement, context: StyleContext) => boolean;
  paint: LayerStyle;
}

/** Group state affects descendants without a CSS selector engine. */
export function ancestor(node: MapElement, test: (parent: MapElement) => boolean): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) if (test(parent)) return true;
  return false;
}
