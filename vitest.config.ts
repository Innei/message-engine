import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
    },
    include: ['test/**/*.test.ts'],
  },
});
