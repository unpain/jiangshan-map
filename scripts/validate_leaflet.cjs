// Run against a local static server: node scripts/validate_leaflet.cjs
// Requires Playwright; ATLAS_BROWSER defaults to the installed Edge browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.ATLAS_BROWSER || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
        .filter(node => node.dataset?.polityTitle).map(node => node.dataset.polityTitle);
    });
    assert(hits.includes('秦'), 'Canvas geography must participate in existing hit testing');
    // The SVG and Canvas must follow exactly the same transform, including
    // fractional zoom and the deferred crisp redraw after interaction.
    const alignmentError = () => {
      const app = atlasApp, view = app.mapView, r = view.container.getBoundingClientRect();
      const x = 600, y = 350;
      const expected = view.frame();
      let labelError;
      if (view.moving && view.annotationReady) {
        const a = view.annotationFrame;
        const screen = new DOMPoint(a.x + view.annotationPad.x + x * a.scale, a.y + view.annotationPad.y + y * a.scale)
          .matrixTransform(new DOMMatrix(view.annotationCanvas.style.transform));
        labelError = Math.hypot(screen.x - expected.x - x * expected.scale, screen.y - expected.y - y * expected.scale);
      } else {
        const screen = new DOMPoint(x, y).matrixTransform(app.svg.getScreenCTM());
        labelError = Math.hypot(screen.x - r.left - expected.x - x * expected.scale,
          screen.y - r.top - expected.y - y * expected.scale);
      }
      const c = view.canvasFrame;
      const canvas = new DOMPoint(c.x + view.canvasPad.x + x * c.scale,
        c.y + view.canvasPad.y + y * c.scale).matrixTransform(new DOMMatrix(view.canvas.style.transform));
      const canvasError = Math.hypot(canvas.x - expected.x - x * expected.scale,
        canvas.y - expected.y - y * expected.scale);
      return Math.max(labelError, canvasError);
    };
    await page.evaluate(() => atlasApp.zoomBy(1.2, undefined, undefined, false));
    assert(await page.evaluate(alignmentError) < 1, 'Layers align during fractional zoom');
    await page.waitForFunction(() => !atlasApp.mapView.moving && !atlasApp.mapView.raf);
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
