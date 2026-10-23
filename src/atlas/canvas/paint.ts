import type { MapElement } from '../layers/element';
import type { LayerStyle } from '../layers/style';
import { number, type Bounds } from './geometry';

export interface Paint {
  fill: string; stroke: string; fillAlpha: number; strokeAlpha: number;
  width: number; fixed: boolean; dash: number[]; dashOffset: number;
  join: CanvasLineJoin; cap: CanvasLineCap; rule: CanvasFillRule; strokeFirst: boolean;
  pointer: string; cursor: string;
}
export interface TextRun {
  text: string; x: number; y: number; font: string; spacing: string;
  align: CanvasTextAlign; baseline: CanvasTextBaseline;
}

/** Copy computed values once; LayerStyle itself is live and expensive. */
export function readPaint(css: LayerStyle, opacity: number): Paint {
  return {fill: css.fill, stroke: css.stroke,
    fillAlpha: Number(css.fillOpacity) * opacity, strokeAlpha: Number(css.strokeOpacity) * opacity,
    width: parseFloat(css.strokeWidth) || 0, fixed: css.vectorEffect === 'non-scaling-stroke',
    dash: css.strokeDasharray === 'none' ? [] : css.strokeDasharray.split(/[ ,]+/).map(parseFloat),
    dashOffset: parseFloat(css.strokeDashoffset) || 0,
    join: css.strokeLinejoin as CanvasLineJoin, cap: css.strokeLinecap as CanvasLineCap,
    rule: css.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    strokeFirst: css.paintOrder.startsWith('stroke'), pointer: css.pointerEvents, cursor: css.cursor};
}

/** Text metrics and drawing share explicit font and anchor options. */
export function readText(node: MapElement, css: LayerStyle): TextRun {
  return {text: node.label || '', x: number(node, 'x'), y: number(node, 'y'),
    font: `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`,
    spacing: css.letterSpacing === 'normal' ? '0px' : css.letterSpacing,
    align: css.textAnchor === 'middle' ? 'center' : css.textAnchor === 'end' ? 'right' : 'left',
    baseline: /central|middle/.test(css.dominantBaseline) ? 'middle' : 'alphabetic'};
}

/** Shared by painting, label collision layout and text hit testing. */
export function setTextStyle(ctx: CanvasRenderingContext2D, text: TextRun) {
  ctx.font = text.font; ctx.textAlign = text.align;
  ctx.textBaseline = text.baseline; ctx.letterSpacing = text.spacing;
}

/** Canvas font metrics keep clickable labels aligned with the painted glyphs. */
export function textBounds(ctx: CanvasRenderingContext2D, text: TextRun): Bounds {
  setTextStyle(ctx, text);
  const m = ctx.measureText(text.text);
  return {x: text.x - m.actualBoundingBoxLeft, y: text.y - m.actualBoundingBoxAscent,
    width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
    height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent};
}

/** Non-scaling strokes remain in screen pixels under nested marker transforms. */
export function setStrokeStyle(ctx: CanvasRenderingContext2D, paint: Paint, scale: number) {
  const unit = paint.fixed ? 1 / scale : 1;
  ctx.lineWidth = paint.width * unit;
  ctx.lineJoin = paint.join; ctx.lineCap = paint.cap;
  ctx.setLineDash(paint.dash.map(value => value * unit));
  ctx.lineDashOffset = paint.dashOffset * unit;
}

/** Respect paint-order so halos sit behind text rather than covering it. */
export function paintItem(ctx: CanvasRenderingContext2D, paint: Paint, path?: Path2D, text?: TextRun) {
  if (text) setTextStyle(ctx, text);
  const fill = () => {
    if (paint.fill === 'none' || !paint.fillAlpha) return;
    ctx.globalAlpha = paint.fillAlpha; ctx.fillStyle = paint.fill;
    if (text) ctx.fillText(text.text, text.x, text.y); else if (path) ctx.fill(path, paint.rule);
  };
  const stroke = () => {
    if (paint.stroke === 'none' || !paint.strokeAlpha || !paint.width) return;
    ctx.globalAlpha = paint.strokeAlpha; ctx.strokeStyle = paint.stroke;
    if (text) ctx.strokeText(text.text, text.x, text.y); else if (path) ctx.stroke(path);
  };
  if (paint.strokeFirst) { stroke(); fill(); } else { fill(); stroke(); }
}
