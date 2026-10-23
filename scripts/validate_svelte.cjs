const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

// Run identical feature contracts against the second entry to catch framework drift.
const base = process.env.ATLAS_URL || 'http://localhost:8765/';
const env = {...process.env, ATLAS_FRAMEWORK: 'svelte',
  ATLAS_URL: new URL('svelte.html', base.endsWith('/') || /\.html$/.test(base) ? base : `${base}/`).href};
for (const script of ['validate_leaflet.cjs', 'validate_vue.cjs', 'validate_canvas_annotations.cjs']) {
  execFileSync(process.execPath, [resolve(__dirname, script)], {env, stdio: 'inherit'});
}
