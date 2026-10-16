import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// Test design (gate-test): config_valida, config_sem_database_url [erro].
// The env is passed in as a plain object so the tests never read the real .env.
describe('loadConfig', () => {
  it('config_valida: returns a typed object when the env is valid', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://pipeline:example-password@localhost:5432/pipeline',
      AMQP_URL: 'amqp://pipeline:example-password@localhost:5672',
      LOG_LEVEL: 'debug',
    });

    expect(config).toEqual({
      databaseUrl: 'postgres://pipeline:example-password@localhost:5432/pipeline',
      amqpUrl: 'amqp://pipeline:example-password@localhost:5672',
      logLevel: 'debug',
    });
  });

  it('config_sem_database_url [erro]: throws an error that names DATABASE_URL', () => {
    expect(() =>
      loadConfig({ AMQP_URL: 'amqp://pipeline:example-password@localhost:5672' }),
    ).toThrow(/DATABASE_URL/);
  });
});
