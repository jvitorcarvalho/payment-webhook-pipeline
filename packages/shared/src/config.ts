import { z } from 'zod';

// Every setting comes from an environment variable and is checked once, at startup.
// A service that starts with a bad config should fail immediately, not hours later
// when the first webhook arrives.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AMQP_URL: z.string().url(),
  WEBHOOK_SECRET: z.string().min(32),
  INGEST_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

// camelCase in code, UPPER_SNAKE in the environment.
export interface AppConfig {
  databaseUrl: string;
  amqpUrl: string;
  webhookSecret: string;
  ingestPort: number;
  logLevel: LogLevel;
}

// Takes the env as an argument (default: process.env) so tests never touch the real .env.
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Name the variables that failed. Never echo the values: they may be secrets.
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
