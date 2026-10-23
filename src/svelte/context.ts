import { getContext, setContext } from 'svelte';
import { readonly, writable } from 'svelte/store';
import { AtlasSession, type AtlasLoadState } from '../atlas/session';

const atlasKey = Symbol('svelte-atlas');
type AtlasContext = ReturnType<typeof provideAtlas>;

/** Stores contain loading UI only; Leaflet objects stay outside reactive state. */
export function provideAtlas() {
  const state = writable<AtlasLoadState>({status: 'loading', error: ''});
  const session = new AtlasSession(state.set);
  const atlas = {state: readonly(state), retry: session.retry, dispose: session.dispose, ...session.actions};
  setContext(atlasKey, atlas);
  return atlas;
}

/** Controls use their owning shell's session rather than a process singleton. */
export function useAtlas(): AtlasContext {
  const atlas = getContext<AtlasContext | undefined>(atlasKey);
  if (!atlas) throw new Error('Atlas components must be inside App');
  return atlas;
}
