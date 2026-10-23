import { inject, onBeforeUnmount, onMounted, provide, readonly, ref, shallowRef, type InjectionKey } from 'vue';
import { HistoricalAtlasController } from '../atlas/controller';
import { loadAtlasData, loadAtlasScript } from '../atlas/data-loader';

function createAtlas() {
  const controller = shallowRef<HistoricalAtlasController>();
  const status = ref<'loading' | 'ready' | 'error'>('loading');
  const error = ref('');
  let disposed = false;
  let loading = false;
  let switchingLocale = false;

  async function retry() {
    if (loading || disposed || controller.value) return;
    loading = true;
    status.value = 'loading';
    error.value = '';
    try {
      await loadAtlasData();
      if (disposed) return;
      const app = new HistoricalAtlasController();
      controller.value = app;
      window.atlasApp = app;
      window.atlasAPI = {
        locate: options => app.locate(options),
        resolvePlace: (place, year) => app.resolvePlace(place, year),
        inspect: options => app.inspect(options),
        openPerson: (who, index = -1) => app.openPersonChronicle(who, index),
      };
      status.value = 'ready';
    } catch (cause) {
      if (!disposed) {
        error.value = cause instanceof Error ? cause.message : '地图加载失败，请重试';
        status.value = 'error';
      }
    } finally { loading = false; }
  }

  function dispose() {
    disposed = true;
    const app = controller.value;
    if (app) {
      app.destroy();
      if (window.atlasApp === app) {
        delete window.atlasApp;
        delete window.atlasAPI;
      }
    }
    controller.value = undefined;
  }

  return {
    status: readonly(status), error: readonly(error), retry, dispose,
    resetCamera: () => controller.value?.resetCamera(),
    toggleMusic: () => controller.value?.toggleMusic(),
    nextMusicTrack: () => controller.value?.nextMusicTrack(),
    cyclePlaySpeed: () => controller.value?.cyclePlaySpeed(),
    stepTimeline: (direction: -1 | 1) => controller.value?.stepTimelineNode(direction),
    setYear(year: number) {
      const app = controller.value;
      if (!app || app.challenge || !Number.isFinite(year)) return;
      app.stopAutoplay();
      app.jumpToYear(Math.max(app.minYear, Math.min(app.maxYear, Math.trunc(year))));
    },
    togglePlayback() {
      const app = controller.value;
      if (!app || app.challenge) return;
      if (app.activePerson) app.togglePersonAutoplay();
      else if (app.playing) app.stopAutoplay();
      else app.startAutoplay();
    },
    async toggleLocale() {
      const app = controller.value;
      if (!app || switchingLocale) return;
      switchingLocale = true;
      try {
        if (app.locale === 'zh') await loadAtlasScript('i18n_dict.js');
        if (disposed) return;
        app.locale = app.locale === 'en' ? 'zh' : 'en';
        app.applyLocale();
      } catch (cause) {
        // Preserve the working map and allow another language-switch attempt.
        console.error('Language data failed to load', cause);
      } finally { switchingLocale = false; }
    },
  };
}

type AtlasContext = ReturnType<typeof createAtlas>;
const atlasKey: InjectionKey<AtlasContext> = Symbol('atlas');

export function provideAtlas() {
  const atlas = createAtlas();
  provide(atlasKey, atlas);
  onMounted(atlas.retry);
  onBeforeUnmount(atlas.dispose);
  return atlas;
}

export function useAtlas(): AtlasContext {
  const atlas = inject(atlasKey);
  if (!atlas) throw new Error('Atlas components must be inside App');
  return atlas;
}
