import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Library build: `npm run build:lib` → dist/index.js (ES module, no dependencies)
export default defineConfig({
  build: {
    lib: { entry: resolve(import.meta.dirname, 'src/index.ts'), formats: ['es'], fileName: 'index' },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
