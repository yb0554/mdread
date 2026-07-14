import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/storage.ts', 'src/types.ts', 'src/content-transform.ts', 'src/recent.ts', 'src/system-open.ts'],
      thresholds: { lines: 60, functions: 60, statements: 60, branches: 60 },
    },
  },
});
