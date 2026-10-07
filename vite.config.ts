import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Emits dist/sw.js from pwa/sw.js with this build's file list baked in, so the
 * app shell (HTML, JS, CSS incl. lazy routes) is precached and works offline.
 * Fonts and posters are cached at runtime instead (there are many font subsets).
 */
function serviceWorker(): Plugin {
  return {
    name: 'dealo-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => /\.(js|css)$/.test(f))
        .sort();
      const publicFiles = ['manifest.webmanifest', 'favicon.svg', 'icon-192.png'];
      const assets = [...files, ...publicFiles];
      // Hashed chunk names change with any code change; public files keep their names, so hash their contents.
      const hash = createHash('sha256').update(files.join('\n'));
      for (const f of publicFiles) hash.update(readFileSync(new URL(`./public/${f}`, import.meta.url)));
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./pwa/sw.js', import.meta.url), 'utf8').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// `base: './'` + HashRouter means the build works from any host or sub-folder
// (Netlify, Vercel, GitHub Pages, S3, a plain nginx dir…) with no rewrite rules.
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
