import { inject, onBeforeUnmount, onMounted, provide, readonly, ref, type InjectionKey } from 'vue';
import { AtlasSession, type AtlasLoadState } from '../atlas/session';

/** Only loading UI enters Vue reactivity; the shared session owns map state. */
function createAtlas() {
  const status = ref<AtlasLoadState['status']>('loading');
  const error = ref('');
  const session = new AtlasSession(state => {
    status.value = state.status;
    error.value = state.error;
  });
  return {status: readonly(status), error: readonly(error),
    retry: session.retry, dispose: session.dispose, ...session.actions};
}

type AtlasContext = ReturnType<typeof createAtlas>;
const atlasKey: InjectionKey<AtlasContext> = Symbol('atlas');

/** Component teardown also releases the framework-independent map session. */
export function provideAtlas() {
  const atlas = createAtlas();
  provide(atlasKey, atlas);
  onMounted(atlas.retry);
  onBeforeUnmount(atlas.dispose);
  return atlas;
}

/** Fail early when controls have no owning application. */
export function useAtlas(): AtlasContext {
  const atlas = inject(atlasKey);
  if (!atlas) throw new Error('Atlas components must be inside App');
  return atlas;
}
