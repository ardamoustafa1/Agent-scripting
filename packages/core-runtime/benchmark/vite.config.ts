import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { target: 'esnext', outDir: '../benchmark-dist', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 6017, strictPort: true },
  server: { host: '127.0.0.1', port: 6017, strictPort: true },
});
