import type { MercatorProjector } from './projector';

export type Coordinate = [number, number];
export interface GeoBounds { west: number; east: number; south: number; north: number }
export type GeoShape = (
  { type: 'Polygon'; coordinates: Coordinate[][] } |
  { type: 'MultiPolygon'; coordinates: Coordinate[][][] }
) & { _svgPath?: string; _svgPathSmooth?: string };
export interface Camera { x: number; y: number; w: number; h: number; zoom?: number }
export type Locale = 'zh' | 'en';

/** The Canvas renderer has no dependency on Vue or on historical record schemas. */
export interface MapHost {
  svg: SVGSVGElement;
  hoverTip: HTMLElement;
  milestoneBalloon: HTMLElement;
  projector: MercatorProjector;
  camera: Camera;
  terrainMode: boolean;
  challenge: unknown;
  activeMilestone: unknown;
  flyRaf: number | null;
  didPan: boolean;
  lastPinchTime: number;
  _typoDirty: boolean;
  _recordGestureMove(): void;
  _applyCamera(force?: boolean): void;
  _clientToSvgPoint(x: number, y: number): Coordinate;
  _positionMilestoneBalloon(): void;
  _updateScaleBar(): void;
  openGenealogyAt(lng: number, lat: number): void;
}

export interface LocateOptions {
  year?: number | string;
  place?: string | string[];
  lng?: number;
  lat?: number;
  zoom?: number;
  person?: string;
  stop?: number;
}
export interface AtlasAPI {
  locate(options?: LocateOptions): unknown;
  resolvePlace(place: string, year?: number): unknown;
  inspect(options?: LocateOptions): unknown;
  openPerson(person: string, eventIndex?: number): void;
}
