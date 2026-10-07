import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` + HashRouter means the build works from any host or sub-folder
// (Netlify, Vercel, GitHub Pages, S3, a plain nginx dir…) with no rewrite rules.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
