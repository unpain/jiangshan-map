const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const url = (process.env.ATLAS_URL || 'http://localhost:8765').replace(/\/+$/, '');
const channel = process.env.ATLAS_BROWSER || 'msedge';
const ready = page => page.waitForFunction(() => window.atlasApp?.mapView?.visible?.length > 0);

(async () => {
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Hold the entry module to expose the exact HTML-only first paint. Critical
    // styles must hide the SEO directory even before Vite can inject app CSS.
    let releaseEntry;
    const entryGate = new Promise(resolve => { releaseEntry = resolve; });
    let entryRequested;
    const requestSeen = new Promise(resolve => { entryRequested = resolve; });
    await page.route(/\/(?:src\/main\.ts|assets\/index-[^/]+\.js)$/, async route => {
      entryRequested();
      await entryGate;
      await route.continue();
    });
    await page.goto(`${url}/?year=1415`, { waitUntil: 'commit' });
    await requestSeen;
    await page.locator('#app .atlas-loading').waitFor({ state: 'visible' });
    const firstPaint = await page.evaluate(() => {
      const index = document.querySelector('#seo-atlas-directory');
      const css = getComputedStyle(index);
      return {
        mounted: !!window.atlasApp,
        width: index.getBoundingClientRect().width,
        height: index.getBoundingClientRect().height,
        clip: css.clip,
        overflow: css.overflow,
      };
    });
    assert.deepEqual(firstPaint, { mounted: false, width: 1, height: 1, clip: 'rect(0px, 0px, 0px, 0px)', overflow: 'hidden' });
    releaseEntry();
    await ready(page);
    assert.equal(await page.evaluate(() => atlasApp.year), 1415);
    assert.equal(await page.locator('.leaflet-container').count(), 1);
    assert.equal(await page.locator('.atlas-loading').count(), 0);
    await page.evaluate(() => {
      window.stepCalls = 0;
      const step = atlasApp.stepTimelineNode.bind(atlasApp);
      atlasApp.stepTimelineNode = direction => { window.stepCalls++; return step(direction); };
    });
    await page.locator('#act-step-next').click();
    assert.equal(await page.evaluate(() => window.stepCalls), 1, 'Vue button must execute exactly once');
    await page.locator('#inp-year').fill('741');
    await page.locator('#inp-year').press('Tab');
    await page.waitForFunction(() => atlasApp.year === 741);
    await page.locator('#act-play-speed').click();
    assert.equal(await page.locator('#lbl-play-speed').innerText(), '2×');
    await page.locator('#act-autoplay').click();
    await page.waitForFunction(() => atlasApp.playing);
    await page.locator('#act-autoplay').click();
    await page.waitForFunction(() => !atlasApp.playing);
    await page.locator('#act-locale').click();
    await page.waitForFunction(() => atlasApp.locale === 'en');
    await page.locator('#act-locale').click();
    await page.waitForFunction(() => atlasApp.locale === 'zh');

    await page.locator('#inp-map-search').fill('李白');
    await page.waitForFunction(() => document.querySelector('#map-search-results .sr-main')?.textContent?.includes('李白'));
    await page.locator('#map-search-results li:not(.sr-section-head)').first().click();
    await page.waitForFunction(() => atlasApp.activePerson);
    await page.goto(`${url}/?year=1415&lang=en`);
    await ready(page);
    assert.equal(await page.evaluate(() => atlasApp.locale), 'en');
    assert.equal(await page.evaluate(() => atlasApp.year), 1415);

    if (process.env.ATLAS_DEV === '1') {
      await page.evaluate(async () => {
        const old = window.atlasApp;
        old.startAutoplay();
        // Exercise pending camera callbacks at unmount, not just an idle instance.
        old.mapView.onWheel(new WheelEvent('wheel', { deltaY: -120, clientX: 400, clientY: 300 }));
        document.querySelector('#app').__vue_app__.unmount();
        if (!old.scope.disposed || window.atlasApp || window.atlasAPI) throw new Error('Atlas was not disposed');
        window.oldAtlas = old;
        const { createApp } = await import('/node_modules/.vite/deps/vue.js');
        const { default: App } = await import('/src/App.vue');
        createApp(App).mount('#app');
      });
      await ready(page);
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.leaflet-container').count(), 1);
      assert.equal(await page.locator('.atlas-canvas').count(), 1);
      const oldYear = await page.evaluate(() => window.oldAtlas.year);
      await page.locator('#inp-year').focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => window.oldAtlas.year), oldYear, 'Unmounted keyboard listener must be removed');
    }

    const failed = await browser.newPage();
    failed.on('pageerror', error => errors.push(error.message));
    let abortOnce = true;
    await failed.route('**/js/map_data.js*', route => {
      if (abortOnce) { abortOnce = false; return route.abort(); }
      return route.continue();
    });
    await failed.goto(url);
    await failed.getByRole('button', { name: '重新加载' }).waitFor();
    assert.equal(await failed.evaluate(() => !!window.atlasApp), false);
    await failed.getByRole('button', { name: '重新加载' }).click();
    await ready(failed);
    assert.equal(await failed.locator('.leaflet-container').count(), 1);
    assert.deepEqual(errors, []);
    console.log('✓ Vue: single event binding, year/playback, search, locale, deep links, data retry' + (process.env.ATLAS_DEV === '1' ? ', unmount/remount cleanup' : ''));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
