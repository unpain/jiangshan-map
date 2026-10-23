const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const controller = read('src/atlas/controller.js');
const projector = read('src/atlas/projector.ts');

// Exercise the same domain implementation without importing Leaflet's DOM runtime.
// Browser integration and lifecycle are covered separately by Playwright.
const projectorJs = ts.transpileModule(projector, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^export /gm, '').replace(/^const (RAD_TO_DEG|DEG_TO_RAD) = .*;\r?\n/gm, '');
const runtimeCode = controller.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\n' + projectorJs + `
window.HistoricalAtlasController = HistoricalAtlasController;
window.MercatorProjector = MercatorProjector;
`;

exports.runtimeCode = runtimeCode;
exports.appCode = controller + '\n' + projector;
exports.composable = read('src/composables/useAtlas.ts');
exports.session = read('src/atlas/session.ts');
exports.markup = () => read('index.html') + ['AtlasHeader', 'MapViewport', 'ChroniclePane', 'TimelineDock']
  .map(name => read(`src/components/${name}.vue`)).join('\n');
