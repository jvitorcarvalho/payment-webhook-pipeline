import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig, createLogger } from '@pipeline/shared';
import { buildApp } from './app.js';

// Load the git-ignored .env at the repository root, only if it exists.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig();
const logger = createLogger({ service: 'ingest-api', level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = buildApp({ pool, config, logger });

try {
  await app.listen({ port: config.ingestPort, host: '0.0.0.0' });
  logger.info({ port: config.ingestPort }, 'Server started');
} catch (error) {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
}
