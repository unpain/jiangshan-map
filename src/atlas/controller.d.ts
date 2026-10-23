import type { Locale, LocateOptions } from './types';
import type { LeafletAtlasMap } from './leaflet-map';
import type { AtlasScope } from './scope';

/** Typed boundary around the existing historical narrative/domain renderer. */
export class HistoricalAtlasController {
  constructor();
  scope: AtlasScope;
  mapView: LeafletAtlasMap;
  locale: Locale;
  year: number;
  minYear: number;
  maxYear: number;
  playing: boolean;
  challenge: unknown;
  activePerson: unknown;
  musicAudio: HTMLAudioElement | null;
  destroy(): void;
  applyLocale(): void;
  jumpToYear(year: number): void;
  stepTimelineNode(direction: -1 | 1): void;
  resetCamera(): void;
  toggleMusic(): void;
  nextMusicTrack(): void;
  startAutoplay(): void;
  stopAutoplay(): void;
  togglePersonAutoplay(): void;
  cyclePlaySpeed(): void;
  locate(options?: LocateOptions): unknown;
  resolvePlace(place: string, year?: number): unknown;
  inspect(options?: LocateOptions): unknown;
  openPersonChronicle(person: string, eventIndex?: number): void;
}
