import { MapElement } from './element';

// Paint order is shared by rendering and picking, from terrain to foreground pins.
const groups = {
  grpTerrain: 'terrain', grpNeighbors: 'neighbors', grpProvinces: 'provinces',
  grpPolities: 'polities', grpPrefectures: 'prefectures', grpRivers: 'rivers',
  grpGhostDiff: 'ghost-diff', grpCorridors: 'corridors', grpProvNames: 'prov-names',
  grpSettlements: 'settlements', grpMilestones: 'milestones', grpJourney: 'journey',
  grpChallenge: 'challenge', grpGenealogy: 'genealogy',
};

/** Layer groups retain the established stacking order without a hidden template. */
export function createAtlasLayers() {
  const scene = new MapElement('group', {id: 'atlas-scene', class: 'terrain-active'});
  const layers = Object.fromEntries(Object.entries(groups).map(([field, name]) => {
    const layer = new MapElement('group', {id: `grp-${name}`});
    scene.addLayer(layer);
    return [field, layer];
  }));
  layers.grpTerrain.addLayer(new MapElement('image', {
    id: 'terrain-relief', src: 'assets/terrain_relief.webp', x: -80, y: -40,
    width: 1160, height: 780, opacity: 0.48,
  }));
  layers.grpProvNames.tags.add('is-hidden');
  return {scene, ...layers};
}
