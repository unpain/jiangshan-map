// Actual browser wheel input, including startup fonts and the final redraw.
// Requires Playwright; ATLAS_URL defaults to http://localhost:8765.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.ATLAS_BROWSER === 'chromium' ? {} : { channel: process.env.ATLAS_BROWSER || 'msedge' })});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2});
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
      window.wheelMetrics = {frames: [], longTasks: [], calls: {}};
      let previous;
      const tick = time => {
        if (previous) wheelMetrics.frames.push(time - previous);
        previous = time;
        window.frameRequest = requestAnimationFrame(tick);
      };
      frameRequest = requestAnimationFrame(tick);
      window.longTaskObserver = new PerformanceObserver(list => {
        wheelMetrics.longTasks.push(...list.getEntries().map(entry => entry.duration));
      });
      longTaskObserver.observe({type: 'longtask'});
      for (const [object, names] of [
        [atlasApp, ['_rescaleSvgTypography']],
        [atlasApp.mapView, ['commit', 'draw', 'cacheAnnotations']],
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
    await page.waitForFunction(() => !atlasApp.mapView.moving && !atlasApp.mapView.wheelRaf &&
      !atlasApp.mapView.annotationDirty && !atlasApp.mapView.raf);
    const result = await page.evaluate(() => {
      cancelAnimationFrame(frameRequest); longTaskObserver.disconnect();
      const frames = wheelMetrics.frames.sort((a,b) => a-b);
      return {scenario: '32 real wheel events, 70 ms apart; 1440x1000 @ DPR 2; year 1415',
        calls: wheelMetrics.calls, longTasks: wheelMetrics.longTasks,
        frames: {count: frames.length, medianMs: frames[Math.floor(frames.length * .5)],
          p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1)}};
    });
    assert.equal(result.calls.commit.count, 1, 'One redraw after the wheel gesture ends');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
