// Run against the Vite dev or preview server: node scripts/validate_leaflet.cjs
// Requires Playwright; ATLAS_BROWSER defaults to the installed Edge browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.ATLAS_BROWSER === 'chromium' ? {} : { channel: process.env.ATLAS_BROWSER || 'msedge' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    if (process.env.ATLAS_OFFLINE === '1') {
      const origin = new URL(process.env.ATLAS_URL || 'http://localhost:8765').origin;
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.ATLAS_URL || 'http://localhost:8765', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.atlasApp?._fullSnapshotsLoaded && window.atlasApp?.mapView?.visible?.length);
    const x = await page.evaluate(() => atlasApp.camera.x);
    await page.mouse.move(450, 300);
    await page.mouse.down();
    await page.mouse.move(580, 360, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(old => atlasApp.camera.x !== old, x);
    const zoom = await page.evaluate(() => atlasApp.mapView.map.getZoom());
    await page.mouse.wheel(0, -180);
    await page.waitForFunction(old => atlasApp.mapView.map.getZoom() > old, zoom);
    for (const year of [741, 1415, 2025, -350]) {
      await page.evaluate(y => atlasApp.jumpToYear(y), year);
      await page.waitForFunction(() => {
        const app = atlasApp;
        return app.lastRenderedSnap === app.snapshots[app.activeSnapKey] && !app.mapView.dirty;
      });
      assert.equal(await page.locator('#grp-prefectures path[d], #grp-polities path[d]').count(), 0);
      assert(await page.evaluate(() => atlasApp.mapView.visible.length > 100));
    }
    await page.evaluate(() => {
      atlasApp.closeMilestoneBalloon();
      atlasApp.hoverTip.classList.add('is-hidden');
    });
    const hits = await page.evaluate(() => {
      const app = atlasApp, [x, y] = app.projector.toScreen(108.94, 34.26);
      const p = app.mapView.map.latLngToContainerPoint([-y, x]);
      const r = app.mapView.container.getBoundingClientRect();
      return app.mapView.elementsFromPoint(r.left + p.x, r.top + p.y)
        .filter(node => node.metadata?.polityTitle).map(node => node.metadata.polityTitle);
    });
    assert(hits.includes('秦'), 'Canvas geography must participate in existing hit testing');
    // Both Canvas layers must follow the same camera at fractional zoom.
    const alignmentError = () => {
      const app = atlasApp, view = app.mapView, r = view.container.getBoundingClientRect();
      const x = 600, y = 350;
      const expected = view.frame();
      const a = view.annotationFrame;
      const labelError = Math.hypot(a.x + x * a.scale - expected.x - x * expected.scale,
        a.y + y * a.scale - expected.y - y * expected.scale);
      const c = view.canvasFrame;
      const canvas = new DOMPoint(c.x + view.canvasPad.x + x * c.scale,
        c.y + view.canvasPad.y + y * c.scale).matrixTransform(new DOMMatrix(view.canvas.style.transform));
      const canvasError = Math.hypot(canvas.x - expected.x - x * expected.scale,
        canvas.y - expected.y - y * expected.scale);
      return Math.max(labelError, canvasError);
    };
    await page.evaluate(() => atlasApp.zoomBy(1.2, undefined, undefined, false));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert(await page.evaluate(alignmentError) < 1, 'Layers align during fractional zoom');
    await page.waitForFunction(() => !atlasApp.mapView.moving && !atlasApp.mapView.raf && !atlasApp.mapView.annotationRaf);
    assert(await page.evaluate(alignmentError) < 1, 'Layers align after deferred redraw');
    const hoverPoint = await page.evaluate(() => {
      const app = atlasApp, [x, y] = app.projector.toScreen(107.5, 33.5);
      const p = app.mapView.map.latLngToContainerPoint([-y, x]);
      const r = app.mapView.container.getBoundingClientRect();
      return {x: r.left + p.x, y: r.top + p.y};
    });
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForFunction(() => !atlasApp.hoverTip.classList.contains('is-hidden'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => atlasApp.mapView.map.getSize().x < 400);
    assert.deepEqual(errors, []);
    console.log('✓ Leaflet: drag, wheel, four snapshots, hit testing, layer alignment, hover tooltip, mobile resize');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
