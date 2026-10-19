import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import Fastify, { type FastifyRequest } from 'fastify';
import { loadConfig } from '@pipeline/shared';
import { computeSignature } from '@pipeline/shared/signature.js';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const { Pool } = pg;

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });

async function truncateTables() {
  await pool.query('TRUNCATE outbox, payment_events RESTART IDENTITY CASCADE');
}

interface RequestWithRawBody extends FastifyRequest {
  rawBody: string | Buffer;
}

function buildTestApp() {
  const app = Fastify({ logger: false });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    // Store raw body for signature verification
    (req as RequestWithRawBody).rawBody = body;
    // Always pass the raw body to the handler; let the handler parse JSON
    done(null, body);
  });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.post('/webhooks/payments', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody.toString();
    const signatureHeader = request.headers['x-signature'] as string | undefined;

    const { verifySignature } = await import('@pipeline/shared/signature.js');
    const verification = verifySignature(config.webhookSecret, signatureHeader, rawBody);
    if (!verification.valid) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    const eventId = payload.event_id as string;
    if (!eventId) {
      return reply.code(400).send({ error: 'Missing event_id' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const eventResult = await client.query(
        'INSERT INTO payment_events (event_id, payload) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
        [eventId, JSON.stringify(payload)],
      );

      if (eventResult.rowCount !== null && eventResult.rowCount > 0) {
        await client.query('INSERT INTO outbox (event_id, topic, payload) VALUES ($1, $2, $3)', [
          eventId,
          'payment.succeeded',
          JSON.stringify(payload),
        ]);
      }

      await client.query('COMMIT');
      return reply.code(200).send({ status: 'accepted' });
    } catch {
      await client.query('ROLLBACK');
      return reply.code(500).send({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  return app;
}

describe('ingest-api integration tests', () => {
  let app: Fastify.FastifyInstance;

  beforeEach(async () => {
    await truncateTables();
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
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
});
