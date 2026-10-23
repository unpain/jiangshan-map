type AtlasScript = 'china_geo_data.js' | 'atlas_boot.js' | 'map_data.js' | 'lore_data.js' | 'atlas_snapshots.js' | 'i18n_dict.js';
const pending = new Map<AtlasScript, Promise<void>>();

/** Generated data retains its lazy geometry decoder and never enters Vue reactivity. */
export function loadAtlasScript(file: AtlasScript): Promise<void> {
  const existing = pending.get(file);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`js/${file}?v=20261023-vue1`, document.baseURI).href;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error(`地图数据加载失败：${file}`)); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { pending.delete(file); throw error; });
  pending.set(file, promise);
  return promise;
}

export async function loadAtlasData(): Promise<void> {
  // Boot precedes metadata because generated bundles may reference earlier globals.
  for (const file of ['china_geo_data.js', 'atlas_boot.js', 'map_data.js', 'lore_data.js'] as const) {
    await loadAtlasScript(file);
  }
  // All ready-state features, including deep links, require the complete snapshots.
  await loadAtlasScript('atlas_snapshots.js');
  if (new URLSearchParams(location.search).get('lang') === 'en') await loadAtlasScript('i18n_dict.js');
}
