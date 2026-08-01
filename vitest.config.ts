import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Testcontainers pulls an image and boots MongoDB on first run.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
