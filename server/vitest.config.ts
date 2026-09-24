import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file resets the same database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: './test/global-setup.ts',
  },
});
