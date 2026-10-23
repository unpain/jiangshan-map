// Exercise real pointer input against native Leaflet layers, with no map SVG tree.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const url = process.env.ATLAS_URL || 'http://localhost:8765';
const channel = process.env.ATLAS_BROWSER || 'msedge';
const ready = page => page.waitForFunction(() => window.atlasApp?._fullSnapshotsLoaded &&
  atlasApp.mapView.annotationReady && !atlasApp.mapView.annotationDirty &&
  !atlasApp.mapView.annotationRaf && !atlasApp.mapView.dirty && !atlasApp.mapView.raf &&
  !atlasApp.mapView.coverageRaf && !atlasApp.mapView.commitRaf &&
  !atlasApp.mapView.moving && !atlasApp.flyRaf);

// Pick an on-screen node and verify there really are pixels at its hit target.
async function pointFor(page, selector) {
  return page.evaluate(selector => {
    const app = atlasApp, view = app.mapView, rect = view.container.getBoundingClientRect();
    for (const item of view.annotations.items) {
      if (!(Array.isArray(selector) ? selector : [selector]).some(query => item.node.matches(query))) continue;
      const box = item.node.getScreenBounds();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      if (x < rect.left + 50 || x > rect.right - 50 || y < rect.top + 80 || y > rect.bottom - 160) continue;
      if (!view.elementsFromPoint(x, y).includes(item.node)) continue;
      const ratio = view.annotationCanvas.width / rect.width;
      const pixels = view.annotations.ctx.getImageData(Math.floor((x - rect.x) * ratio) - 4,
        Math.floor((y - rect.y) * ratio) - 4, 8, 8).data;
      if (!pixels.some((v, i) => i % 4 === 3 && v)) throw new Error('Hit target has no Canvas pixels');
      return {x, y, stop: item.node.ancestor({tags: ['journey-node']})?.metadata.stopIdx};
    }
    throw new Error(`No visible hit for ${selector}`);
  }, selector);
}

async function checkLayers(page) {
  for (const [id, group] of [['settlements', 'settlements'], ['corridors', 'corridors'], ['polities', 'polities']]) {
    await page.evaluate(id => {
      const input = document.getElementById(`chk-${id}`);
      input.checked = false; input.dispatchEvent(new Event('change'));
    }, id);
    await ready(page);
    assert.equal(await page.evaluate(group => atlasApp.mapView.annotations.items
      .filter(i => i.node.ancestor({id: `grp-${group}`})).length, group), 0, `Hide ${group}`);
    await page.evaluate(id => {
      const input = document.getElementById(`chk-${id}`);
      input.checked = true; input.dispatchEvent(new Event('change'));
    }, id);
    await ready(page);
    assert(await page.evaluate(group => atlasApp.mapView.annotations.items
      .some(i => i.node.ancestor({id: `grp-${group}`})), group), `Restore ${group}`);
  }
}

// Native layer removal must remove its pixels and hits without losing its data.
async function checkLifecycle(page) {
  // Idle cleanup schedules geography separately from labels; compare settled frames.
  await ready(page);
  const result = await page.evaluate(async () => {
    const app = atlasApp, view = app.mapView, map = view.map;
    const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const feature = view.visible.find(record => record.node.tags.contains('prefecture-shape')).node;
    const commands = feature.get('d'), count = view.visible.length;
    map.removeLayer(feature); await settled();
    const removed = !map.hasLayer(feature) && !view.visible.some(record => record.node === feature);
    map.addLayer(feature); await settled();
    const restored = map.hasLayer(feature) && view.visible.length === count && feature.get('d') === commands;
    map.removeLayer(app.grpSettlements); await settled();
    const groupRemoved = !view.annotations.items.some(item => item.node.ancestor({id: 'grp-settlements'}));
    map.addLayer(app.grpSettlements); await settled();
    const label = view.annotations.items.find(item => item.node.ancestor({id: 'grp-settlements'}) && item.text).node;
    label.paint.fill = '#123abc'; await settled();
    const explicitPaint = view.annotations.items.find(item => item.node === label).paint.fill === '#123abc';
    label.paint.fill = ''; await settled();
    const drawImage = view.ctx.drawImage;
    let terrainDraws = 0;
    view.ctx.drawImage = function (image, ...args) {
      if (image === view.terrain) terrainDraws++;
      return drawImage.call(this, image, ...args);
    };
    map.removeLayer(view.terrainLayer); await settled();
    const terrainRemoved = terrainDraws === 0;
    map.addLayer(view.terrainLayer); await settled();
    const terrainRestored = terrainDraws > 0;
    view.ctx.drawImage = drawImage;
    map.removeLayer(view);
    const surfaceRemoved = !view.canvas.isConnected && !view.annotationCanvas.isConnected;
    map.addLayer(view);
    return {removed, restored, groupRemoved, explicitPaint, surfaceRemoved, terrainRemoved, terrainRestored,
      surfacesRestored: view.canvas.isConnected && view.annotationCanvas.isConnected,
      nativeLayers: map.hasLayer(app.scene) && !(app.scene instanceof Node),
      mapSvg: document.querySelectorAll('#atlas-svg, #leaflet-map svg').length};
  });
  assert.deepEqual(result, {removed: true, restored: true, groupRemoved: true, explicitPaint: true,
    surfaceRemoved: true, terrainRemoved: true, terrainRestored: true, surfacesRestored: true, nativeLayers: true, mapSvg: 0});
}

// A camera frame must never re-read SVG styles/layout or reconstruct the scene.
async function checkLiveFrames(page) {
  const result = await page.evaluate(async () => {
    const view = atlasApp.mapView;
    view.annotations.setHover([]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const original = window.getComputedStyle, rebuild = view.annotations.rebuild;
    const nativeRect = Element.prototype.getBoundingClientRect;
    let styles = 0, layouts = 0, scenes = 0, maxError = 0;
    window.getComputedStyle = function (node, ...args) {
      if (!(node instanceof Element)) styles++;
      return original.call(this, node, ...args);
    };
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof SVGElement && this.closest('#leaflet-map')) layouts++;
      return nativeRect.call(this);
    };
    view.annotations.rebuild = function () { scenes++; return rebuild.call(this); };
    try {
      for (let i = 0; i < 20; i++) {
        view.map.panBy([i < 10 ? 45 : -45, 0], {animate: false});
        await new Promise(resolve => requestAnimationFrame(resolve));
        const a = view.annotationFrame, f = view.frame();
        maxError = Math.max(maxError, Math.abs(a.x - f.x), Math.abs(a.y - f.y));
      }
    } finally {
      window.getComputedStyle = original;
      Element.prototype.getBoundingClientRect = nativeRect;
      view.annotations.rebuild = rebuild;
    }
    return {styles, layouts, scenes, maxError};
  });
  assert.deepEqual(result, {styles: 0, layouts: 0, scenes: 0, maxError: 0});
  await ready(page);
}

async function checkDesktop(page) {
  await page.goto(`${url.replace(/\/+$/, '')}?year=1415`, {waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.equal(await page.locator('#atlas-svg, #leaflet-map svg').count(), 0);
  assert(await page.evaluate(() => atlasApp.mapView.map.hasLayer(atlasApp.scene)));
  assert(await page.evaluate(() => atlasApp.scene.findAll({kind: 'path'}).every(layer => atlasApp.mapView.map.hasLayer(layer))));
  await page.evaluate(() => atlasApp.closeMilestoneBalloon());
  const city = await pointFor(page, [{"tags":["name"],"within":{"tags":["settlement-node"]}}]);
  await page.mouse.move(city.x, city.y);
  await page.waitForFunction(() => !atlasApp.hoverTip.classList.contains('is-hidden'));
  await page.mouse.click(city.x, city.y);
  await page.waitForFunction(() => !!atlasApp.activeTrace);
  await ready(page);
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(i => ([{"tags":["trace-pin"]}]).some(query => i.node.matches(query)))));
  await page.evaluate(() => { atlasApp.closeGenealogyCard(); atlasApp.resetCamera(); });
  await ready(page);
  const event = await pointFor(page, [{"tags":["ev-core"],"within":{"tags":["milestone-pin"]}}]);
  await page.mouse.click(event.x, event.y);
  await page.waitForFunction(() => !!atlasApp.activeMilestone);
  await ready(page);
  await page.evaluate(() => atlasApp.closeMilestoneBalloon());
  await checkLayers(page);
  await checkLiveFrames(page);
  await checkLifecycle(page);
  await page.evaluate(() => atlasApp.openPersonChronicle('李白'));
  await ready(page);
  const stop = await pointFor(page, [{"tags":["jn-disc"],"within":{"tags":["journey-node"]}}]);
  await page.mouse.click(stop.x, stop.y);
  await page.waitForFunction(index => atlasApp.activePersonEventIdx === Number(index), stop.stop);
  await ready(page);
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(i => ([{"tags":["journey-track-thread"]},{"tags":["journey-track-focus"]},{"tags":["journey-track-upcoming"]},{"tags":["journey-track-passed"]}]).some(query => i.node.matches(query)))));
  await page.locator('#act-locale').click();
  await page.waitForFunction(() => atlasApp.locale === 'en');
  await ready(page);
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(i => i.text && /[A-Za-z]{3}/.test(i.text.text))));
}

async function checkTouch(browser) {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.goto(`${url.replace(/\/+$/, '')}?year=741`, {waitUntil: 'domcontentloaded'});
  await ready(page);
  await page.evaluate(() => atlasApp.closeMilestoneBalloon());
  const city = await pointFor(page, [{"tags":["name"],"within":{"tags":["settlement-node"]}}]);
  await page.touchscreen.tap(city.x, city.y);
  await page.waitForFunction(() => !!atlasApp.activeTrace);
  await page.evaluate(() => atlasApp.startChallenge({preferCurrentDynasty: true}));
  await ready(page);
  assert(await page.evaluate(() => !atlasApp.mapView.annotations.items.some(item => item.node.tags.contains('region-caption'))));
  await page.touchscreen.tap(195, 250);
  await page.waitForFunction(() => !!atlasApp.challenge.pendingGuess);
  await ready(page);
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(i => ([{"tags":["guess-pin"]}]).some(query => i.node.matches(query)))));
  await page.locator('#act-next-round').click();
  await page.waitForFunction(() => atlasApp.challenge.answered);
  await ready(page);
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(i => ([{"tags":["answer-pin"]}]).some(query => i.node.matches(query)))));
  assert(await page.evaluate(() => atlasApp.mapView.annotations.items.some(item => item.node.tags.contains('error-line') && item.paint.stroke === '#b5452f')));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({headless: true, ...(channel === 'chromium' ? {} : {channel})});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // This regression suite is local; remote analytics/fonts must not gate it.
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    await checkDesktop(page);
    await checkTouch(browser);
    assert.deepEqual(errors, []);
    console.log('✓ Canvas annotations: pixels, city/event/route clicks, layers, native layer lifecycle, explicit paint, no map SVG, live frames, locale, touch quiz');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
