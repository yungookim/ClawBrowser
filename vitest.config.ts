import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'sidecar/**/*.ts'],
      exclude: ['**/*.d.ts', 'sidecar/dist/**', 'sidecar/main.ts'],
      thresholds: {
        global: {
          statements: 80,
          lines: 80,
        },
      },
    },
    deps: {
      inline: ['@tobilu/qmd', 'node-cron'],
    },
  },
});
