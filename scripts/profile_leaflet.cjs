// Actual browser wheel input, including startup fonts and the final redraw.
// Requires Playwright; ATLAS_URL defaults to http://localhost:8765.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.ATLAS_BROWSER === 'chromium' ? {} : { channel: process.env.ATLAS_BROWSER || 'msedge' })});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2});
    if (process.env.ATLAS_OFFLINE === '1') {
      const origin = new URL(process.env.ATLAS_URL || 'http://localhost:8765').origin;
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.ATLAS_URL || 'http://localhost:8765', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.atlasApp?._fullSnapshotsLoaded);
    await page.evaluate(() => atlasApp.jumpToYear(1415));
    await page.waitForTimeout(1800);
    await page.waitForFunction(() => atlasApp.lastRenderedSnap === atlasApp.snapshots[atlasApp.activeSnapKey] &&
      atlasApp.mapView.annotationReady && !atlasApp.mapView.annotationDirty);
    // Do not wait for network fonts: measure the experience a user actually gets.
    await page.evaluate(() => {
      window.wheelMetrics = {frames: [], longTasks: [], calls: {}, maxLayerDrift: 0};
      let previous;
      const tick = time => {
        if (previous) wheelMetrics.frames.push(time - previous);
        previous = time;
        const view = atlasApp.mapView, a = view.annotationFrame, c = view.canvasFrame;
        const point = new DOMPoint(c.x + view.canvasPad.x + 600 * c.scale,
          c.y + view.canvasPad.y + 350 * c.scale).matrixTransform(new DOMMatrix(view.canvas.style.transform));
        wheelMetrics.maxLayerDrift = Math.max(wheelMetrics.maxLayerDrift,
          Math.hypot(point.x - a.x - 600 * a.scale, point.y - a.y - 350 * a.scale));
        window.frameRequest = requestAnimationFrame(tick);
      };
      frameRequest = requestAnimationFrame(tick);
      window.longTaskObserver = new PerformanceObserver(list => {
        wheelMetrics.longTasks.push(...list.getEntries().map(entry => entry.duration));
      });
      longTaskObserver.observe({type: 'longtask'});
      for (const [object, names] of [
        [atlasApp, ['_layoutMapLabels']],
        [atlasApp.mapView, ['commit', 'draw', 'drawAnnotations']],
        [atlasApp.mapView.annotations, ['rebuild']],
      ]) for (const name of names) {
        const original = object[name];
        object[name] = function (...args) {
          const start = performance.now();
          try { return original.apply(this, args); } finally {
            const duration = performance.now() - start;
            const stat = wheelMetrics.calls[name] ||= {count: 0, totalMs: 0, maxMs: 0};
            stat.count++; stat.totalMs += duration; stat.maxMs = Math.max(stat.maxMs, duration);
          }
        };
      }
    });
    await page.mouse.move(550, 400);
    for (let i = 0; i < 32; i++) {
      await page.mouse.wheel(0, i < 16 ? -60 : 60);
      await page.waitForTimeout(70);
    }
    const during = await page.evaluate(() => wheelMetrics.calls.commit?.count || 0);
    assert.equal(during, 0, 'No idle redraw between wheel notches in a continuous gesture');
    assert(await page.evaluate(() => wheelMetrics.calls._layoutMapLabels?.count > 32),
      'Label layout updates continuously while wheel input is still active');
    await page.waitForFunction(() => !atlasApp.mapView.wheelRaf && !atlasApp.mapView.annotationRaf &&
      atlasApp.mapView.moving);
    const beforeIdle = await page.evaluate(() => ({
      layouts: wheelMetrics.calls._layoutMapLabels.count,
      transforms: atlasApp.scene.findAll({kind: 'text'}).map(node => [node.get('transform'), node.paint.display]),
    }));
    await page.waitForFunction(() => !atlasApp.mapView.moving && !atlasApp.mapView.wheelRaf &&
      !atlasApp.mapView.annotationDirty && !atlasApp.mapView.raf);
    const result = await page.evaluate(() => {
      cancelAnimationFrame(frameRequest); longTaskObserver.disconnect();
      const frames = wheelMetrics.frames.sort((a,b) => a-b);
      return {scenario: '32 real wheel events, 70 ms apart; 1440x1000 @ DPR 2; year 1415',
        calls: wheelMetrics.calls, longTasks: wheelMetrics.longTasks, maxLayerDrift: wheelMetrics.maxLayerDrift,
        frames: {count: frames.length, medianMs: frames[Math.floor(frames.length * .5)],
          p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1)}};
    });
    assert.equal(result.calls.commit.count, 1, 'One idle cleanup after the wheel gesture ends');
    assert.equal(result.calls._layoutMapLabels.count, beforeIdle.layouts, 'Stopping does not reflow labels again');
    assert.deepEqual(await page.evaluate(() => atlasApp.scene.findAll({kind: 'text'})
      .map(node => [node.get('transform'), node.paint.display])), beforeIdle.transforms,
      'Label positions and visibility remain unchanged when scrolling stops');
    assert(result.maxLayerDrift < 1, 'Live labels and geography align on every gesture frame');
    assert(result.calls.draw.count >= result.calls._layoutMapLabels.count,
      'Geography repaints with live layouts to preserve stroke widths during zoom');
    assert.deepEqual(errors, []);
    result.network = process.env.ATLAS_OFFLINE === '1' ? 'local resources only' : 'online';
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
