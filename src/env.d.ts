import type { HistoricalAtlasController } from './atlas/controller';
import type { AtlasAPI } from './atlas/types';
declare global {
  interface Window {
    atlasApp?: HistoricalAtlasController;
    atlasAPI?: AtlasAPI;
  }
}
export {};
