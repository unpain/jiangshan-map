// Local screenshot entry point used by the Python skill helper after a Vite build.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const sirv = require('sirv');
const { chromium } = require('playwright');

(async () => {
  const [query = '', output] = process.argv.slice(2);
  const build = path.resolve(__dirname, '../dist');
  if (!output || !fs.existsSync(path.join(build, 'index.html'))) {
    throw new Error('Run npm install && npm run build before rendering a local screenshot.');
  }
  const server = http.createServer(sirv(build, { dev: true }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const channel = process.env.ATLAS_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium');
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : channel === 'chromium' ? {} : { channel }),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Offline captures use local fonts and assets; do not wait for analytics/fonts.
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
    await page.waitForFunction(() => window.atlasApp?.mapView?.visible?.length > 0);
    await page.waitForTimeout(600); // Let deep-link camera animations finish.
    await page.waitForFunction(() => !atlasApp.flyRaf && !atlasApp.mapView.dirty && !atlasApp.mapView.moving);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.screenshot({ path: path.resolve(output) });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
