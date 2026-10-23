import type { MapElement } from './element';
import type { LayerStyle, StyleContext } from './style';
import type { PaintRule } from './paint-rule';
import { geographyPaint } from './geography-paint';
import { markersPaint } from './markers-paint';
import { journeysPaint } from './journeys-paint';

const rules = new Map<string, PaintRule[]>();
for (const rule of [...geographyPaint, ...markersPaint, ...journeysPaint]) {
  const bucket = rules.get(rule.key) || [];
  bucket.push(rule); rules.set(rule.key, bucket);
}

/** Feature indexing avoids testing every style against every river and border. */
export function applyCartography(node: MapElement, context: StyleContext, style: LayerStyle, important = false) {
  const keys = [node.kind, `#${node.id}`, ...node.tags.toString().split(' ')];
  const matches = keys.flatMap(key => rules.get(key) || [])
    .filter(rule => rule.important === important && rule.when(node, context))
    .sort((a, b) => a.order - b.order);
  for (const rule of matches) Object.assign(style, rule.paint);
}
