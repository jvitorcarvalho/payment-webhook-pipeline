import { describe, expect, it, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { Writable } from 'node:stream';
import pg from 'pg';
import { loadConfig, createLogger } from '@pipeline/shared';
import { computeSignature } from '@pipeline/shared/signature.js';
import { buildApp } from '../src/app.js';

// Load the git-ignored .env only if it exists (CI and fresh clones may not have one).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { Pool } = pg;

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });

// Throw-away log destination: these tests assert on HTTP status and rows, not on logs.
const silentLogs = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const logger = createLogger({
  service: 'ingest-api-test',
  level: 'fatal',
  destination: silentLogs,
});

async function truncateTables() {
  await pool.query('TRUNCATE outbox, payment_events RESTART IDENTITY CASCADE');
}

describe('ingest-api integration tests', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await truncateTables();
    // The real app from src/app.ts, wired to the real pool.
    app = buildApp({ pool, config, logger });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  function makeSignedRequest(eventId: string, timestampOffset = 0) {
    const timestamp = Math.floor((Date.now() + timestampOffset) / 1000);
    const payload = {
      event_id: eventId,
      amount: 100,
      currency: 'BRL',
      customer: 'Fictional Customer',
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(config.webhookSecret, timestamp, rawBody).toString('hex');
    const header = `t=${timestamp},v1=${signature}`;
    return { rawBody, header, payload };
  }

  it('webhook_valido: signed POST with new event_id returns 200 and writes to both tables', async () => {
    const { rawBody, header } = makeSignedRequest('evt_test_1');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'application/json' },
      body: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'accepted' });

    const events = await pool.query('SELECT * FROM payment_events WHERE event_id = $1', [
      'evt_test_1',
    ]);
    expect(events.rowCount).toBe(1);

    const outbox = await pool.query('SELECT * FROM outbox WHERE event_id = $1', ['evt_test_1']);
    expect(outbox.rowCount).toBe(1);
  });

  it('assinatura_invalida [erro]: POST with tampered v1 returns 401 and writes nothing', async () => {
    const { rawBody } = makeSignedRequest('evt_test_2');
    const tamperedHeader = 't=' + Math.floor(Date.now() / 1000) + ',v1=' + '0'.repeat(64);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': tamperedHeader, 'content-type': 'application/json' },
      body: rawBody,
    });

    expect(response.statusCode).toBe(401);

    const events = await pool.query('SELECT * FROM payment_events WHERE event_id = $1', [
      'evt_test_2',
    ]);
    expect(events.rowCount).toBe(0);

    const outbox = await pool.query('SELECT * FROM outbox WHERE event_id = $1', ['evt_test_2']);
    expect(outbox.rowCount).toBe(0);
  });

  it('timestamp_velho [erro]: timestamp 10 minutes old with correct signature returns 401', async () => {
    const { rawBody, header } = makeSignedRequest('evt_test_3', -10 * 60 * 1000);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'application/json' },
      body: rawBody,
    });

    expect(response.statusCode).toBe(401);

    const events = await pool.query('SELECT * FROM payment_events WHERE event_id = $1', [
      'evt_test_3',
    ]);
    expect(events.rowCount).toBe(0);

    const outbox = await pool.query('SELECT * FROM outbox WHERE event_id = $1', ['evt_test_3']);
    expect(outbox.rowCount).toBe(0);
  });

  it('evento_duplicado [borda]: same event_id sent twice returns 200 both times, only 1 outbox row', async () => {
    const { rawBody, header } = makeSignedRequest('evt_test_4');

    const response1 = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'application/json' },
      body: rawBody,
    });
    expect(response1.statusCode).toBe(200);

    const response2 = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'application/json' },
      body: rawBody,
    });
    expect(response2.statusCode).toBe(200);

    const events = await pool.query('SELECT * FROM payment_events WHERE event_id = $1', [
      'evt_test_4',
    ]);
    expect(events.rowCount).toBe(1);

    const outbox = await pool.query('SELECT * FROM outbox WHERE event_id = $1', ['evt_test_4']);
    expect(outbox.rowCount).toBe(1);
  });

  it('corpo_malformado [erro]: invalid JSON with valid signature returns 400 and writes nothing', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '{ invalid json';
    const signature = computeSignature(config.webhookSecret, timestamp, rawBody).toString('hex');
    const header = `t=${timestamp},v1=${signature}`;

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'application/json' },
      body: rawBody,
    });

    expect(response.statusCode).toBe(400);

    const events = await pool.query('SELECT * FROM payment_events');
    expect(events.rowCount).toBe(0);

    const outbox = await pool.query('SELECT * FROM outbox');
    expect(outbox.rowCount).toBe(0);
  });

  async function expectNothingStored() {
    const events = await pool.query('SELECT * FROM payment_events');
    expect(events.rowCount).toBe(0);
    const outbox = await pool.query('SELECT * FROM outbox');
    expect(outbox.rowCount).toBe(0);
  }

  it.each([['null'], ['42'], ['"text"'], ['[]'], ['true']])(
    'corpo_nao_objeto [erro]: signed JSON body %s returns 400 and writes nothing',
    async (rawBody) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = computeSignature(config.webhookSecret, timestamp, rawBody).toString('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/payments',
        headers: {
          'x-signature': `t=${timestamp},v1=${signature}`,
          'content-type': 'application/json',
        },
        body: rawBody,
      });

      expect(response.statusCode).toBe(400);
      await expectNothingStored();
    },
  );

  it('event_id_invalido [erro]: signed body with a non-string event_id returns 400 and writes nothing', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ event_id: 123 });
    const signature = computeSignature(config.webhookSecret, timestamp, rawBody).toString('hex');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: {
        'x-signature': `t=${timestamp},v1=${signature}`,
        'content-type': 'application/json',
      },
      body: rawBody,
    });

    expect(response.statusCode).toBe(400);
    await expectNothingStored();
  });

  it('sem_content_type [erro]: POST without body and content-type returns 400 or 415, not 500', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
    });

    expect([400, 415]).toContain(response.statusCode);
    await expectNothingStored();
  });

  it('content_type_errado [erro]: text/plain body returns 400 or 415, not 500', async () => {
    const { rawBody, header } = makeSignedRequest('evt_test_5');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { 'x-signature': header, 'content-type': 'text/plain' },
      body: rawBody,
    });

    expect([400, 415]).toContain(response.statusCode);
    await expectNothingStored();
  });
});
