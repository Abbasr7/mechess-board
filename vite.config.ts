import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The demo lives in ./demo; piece artwork is borrowed from the sibling app's public folder
// (any folder that serves /pieces/<set>/<wk|bp|...>.svg works).
export default defineConfig({
  root: 'demo',
  publicDir: resolve(import.meta.dirname, '../mechess-front/public'),
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { port: 5199, fs: { allow: [resolve(import.meta.dirname, '..')] } },
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
