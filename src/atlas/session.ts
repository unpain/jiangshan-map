import { HistoricalAtlasController } from './controller';
import { loadAtlasData, loadAtlasScript } from './data-loader';

export interface AtlasLoadState { status: 'loading' | 'ready' | 'error'; error: string }

/** Each framework shell owns one session, keeping the map outside reactive proxies. */
export class AtlasSession {
  private controller?: HistoricalAtlasController;
  private disposed = false;
  private loading = false;
  private switchingLocale = false;

  constructor(private report: (state: AtlasLoadState) => void) {}

  /** Retry data downloads without creating duplicate maps. */
  retry = async () => {
    if (this.loading || this.disposed || this.controller) return;
    this.loading = true;
    this.report({status: 'loading', error: ''});
    try {
      await loadAtlasData();
      if (!this.disposed) this.attach();
    } catch (cause) {
      if (!this.disposed) this.report({status: 'error',
        error: cause instanceof Error ? cause.message : '地图加载失败，请重试'});
    } finally { this.loading = false; }
  };

  /** Expose the same integration API from either framework. */
  private attach() {
    const app = new HistoricalAtlasController();
    this.controller = app;
    window.atlasApp = app;
    window.atlasAPI = {
      locate: options => app.locate(options),
      resolvePlace: (place, year) => app.resolvePlace(place, year),
      inspect: options => app.inspect(options),
      openPerson: (who, index = -1) => app.openPersonChronicle(who, index),
    };
    this.report({status: 'ready', error: ''});
  }

  /** Unmounting releases listeners, animation frames and Leaflet. */
  dispose = () => {
    this.disposed = true;
    const app = this.controller;
    if (app) {
      app.destroy();
      if (window.atlasApp === app) {
        delete window.atlasApp;
        delete window.atlasAPI;
      }
    }
    this.controller = undefined;
  };

  /** Timeline edits obey identical bounds and challenge restrictions. */
  private setYear(year: number) {
    const app = this.controller;
    if (!app || app.challenge || !Number.isFinite(year)) return;
    app.stopAutoplay();
    app.jumpToYear(Math.max(app.minYear, Math.min(app.maxYear, Math.trunc(year))));
  }

  /** Person routes and ordinary chronology share the playback button. */
  private togglePlayback() {
    const app = this.controller;
    if (!app || app.challenge) return;
    if (app.activePerson) app.togglePersonAutoplay();
    else if (app.playing) app.stopAutoplay();
    else app.startAutoplay();
  }

  /** Failed language downloads leave the working map available for another attempt. */
  private async toggleLocale() {
    const app = this.controller;
    if (!app || this.switchingLocale) return;
    this.switchingLocale = true;
    try {
      if (app.locale === 'zh') await loadAtlasScript('i18n_dict.js');
      if (this.disposed) return;
      app.locale = app.locale === 'en' ? 'zh' : 'en';
      app.applyLocale();
    } catch (cause) {
      console.error('Language data failed to load', cause);
    } finally { this.switchingLocale = false; }
  }

  /** Carry live timeline state across entries, including subdirectory deployments. */
  private switchFramework(framework: 'vue' | 'svelte') {
    const url = new URL(framework === 'svelte' ? 'svelte.html' : './', window.location.href);
    const app = this.controller;
    if (app) {
      url.searchParams.set('year', String(app.year));
      url.searchParams.set('lang', app.locale);
    }
    window.location.assign(url.href);
  }

  readonly actions = {
    switchFramework: (framework: 'vue' | 'svelte') => this.switchFramework(framework),
    resetCamera: () => this.controller?.resetCamera(),
    toggleMusic: () => this.controller?.toggleMusic(),
    nextMusicTrack: () => this.controller?.nextMusicTrack(),
    cyclePlaySpeed: () => this.controller?.cyclePlaySpeed(),
    stepTimeline: (direction: -1 | 1) => this.controller?.stepTimelineNode(direction),
    setYear: (year: number) => this.setYear(year),
    togglePlayback: () => this.togglePlayback(),
    toggleLocale: () => this.toggleLocale(),
  };
}
