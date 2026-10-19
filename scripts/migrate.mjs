#!/usr/bin/env node
// Migration runner: applies *.sql files in migrations/ in lexical order.
// Records applied versions in schema_migrations table.

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';
import { existsSync } from 'node:fs';

// Load the git-ignored .env at the repository root, only if it exists.
const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Inline config loading to avoid TypeScript compilation step
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AMQP_URL: z.string().url(),
  WEBHOOK_SECRET: z.string().min(32),
  INGEST_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration, check these variables: ${problems}`);
  }
  return {
    databaseUrl: result.data.DATABASE_URL,
    amqpUrl: result.data.AMQP_URL,
    webhookSecret: result.data.WEBHOOK_SECRET,
    ingestPort: result.data.INGEST_PORT,
    logLevel: result.data.LOG_LEVEL,
  };
}

async function runMigrations() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    // Ensure schema_migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already applied migrations
    const appliedResult = await pool.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((r) => r.version));

    // Read migration files
    const migrationsDir = join(__dirname, '..', 'migrations');
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`Applying ${file}...`);
      const sql = await readFile(join(migrationsDir, file), 'utf8');

      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    console.log('All migrations applied.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
