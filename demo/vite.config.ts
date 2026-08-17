import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { messageEngineDemoApi } from './server/api-plugin.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('../demo-dist', import.meta.url)),
    rollupOptions: {
      input: {
        devtools: fileURLToPath(new URL('./devtools.html', import.meta.url)),
        lab: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  plugins: [react(), messageEngineDemoApi()],
  root,
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
