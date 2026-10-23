import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import sirv from 'sirv';
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep generated datasets and SEO tools at their established paths. Only these
// public resources are served/copied; source code and repository files stay out.
function atlasResources(): Plugin {
  const directories = ['js', 'assets', 'topics', 'geojson'];
  const files = ['robots.txt', 'sitemap.xml', 'llms.txt'];
  let root: string;
  let output: string;
  let building = false;
  return {
    name: 'atlas-resources',
    configResolved(config) {
      root = config.root;
      output = resolve(root, config.build.outDir);
      building = config.command === 'build';
    },
    configureServer(server) {
      for (const directory of directories) {
        server.middlewares.use(`/${directory}`, sirv(resolve(root, directory), { dev: true }));
      }
      server.middlewares.use((req, res, next) => {
        if (files.includes((req.url || '').split('?')[0].slice(1))) {
          sirv(root, { dev: true })(req, res, next);
        } else next();
      });
    },
    async closeBundle() {
      if (!building) return;
      await mkdir(output, { recursive: true });
      await Promise.all([...directories, ...files].map(file =>
        cp(resolve(root, file), resolve(output, file), { recursive: true }),
      ));
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [vue({ template: { transformAssetUrls: false } }), atlasResources()],
});
