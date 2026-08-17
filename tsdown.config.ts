import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/devtools.ts', 'src/devtools-react.tsx', 'src/adapters/pi-entry.ts'],
  format: ['esm'],
  inputOptions: {
    resolve: {
      mainFields: ['module', 'main'],
    },
  },
  outDir: 'dist',
  platform: 'neutral',
  sourcemap: true,
  target: 'es2022',
});
