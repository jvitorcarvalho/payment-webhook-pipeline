import { defineConfig } from 'vitest/config';

// Integration tests need `docker compose up -d --wait postgres rabbitmq`.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.int.test.ts', 'services/*/test/**/*.int.test.ts'],
    environment: 'node',
    // Shared database and broker: run files one at a time to avoid interference.
    fileParallelism: false,
  },
});
