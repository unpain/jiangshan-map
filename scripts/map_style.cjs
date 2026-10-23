const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise production paint rules independently of Leaflet's browser runtime.
const sandbox = {};
vm.createContext(sandbox);
const code = ['paint-rule', 'geography-paint', 'markers-paint', 'journeys-paint', 'cartography', 'style'].map(name => ts.transpileModule(
  fs.readFileSync(path.join(__dirname, `../src/atlas/layers/${name}.ts`), 'utf8'),
  {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}
).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
vm.runInContext(`${code}\nthis.resolve = resolveStyle;`, sandbox);

function feature(tags = [], parent, metadata = {}, id = '') {
  return {tags: {contains: tag => tags.includes(tag), toString: () => tags.join(' ')}, parent, metadata, id,
    geometry: {}, paint: {}, kind: 'path'};
}
exports.mapStyle = (tags, options = {}) => {
  const root = feature(options.rootTags || [], undefined, {dynasty: options.dynasty || 'tang'}, 'atlas-scene');
  const parent = options.group ? feature(options.groupTags || [], root, {}, `grp-${options.group}`) : root;
  return sandbox.resolve(feature(tags.split(' '), parent), {width: options.width || 1440, locale: options.locale || 'zh', ...options.context});
};
