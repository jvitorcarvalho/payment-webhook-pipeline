import { defineConfig } from 'vitest/config';

// Unit tests: no Docker needed. Integration tests (*.int.test.ts) have their own config.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
  },
});
