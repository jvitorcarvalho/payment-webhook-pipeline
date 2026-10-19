import Fastify, { type FastifyRequest } from 'fastify';
import pg from 'pg';
import { loadConfig, createLogger, healthStatus } from '@pipeline/shared';
import { verifySignature } from '@pipeline/shared/signature.js';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, '..', '..', '..', '.env') });

const { Pool } = pg;

const config = loadConfig();
const logger = createLogger({ service: 'ingest-api', level: config.logLevel });
const pool = new Pool({ connectionString: config.databaseUrl });

const app = Fastify({
  logger: false,
});

interface RequestWithRawBody extends FastifyRequest {
  rawBody: string | Buffer;
}

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  // Store raw body for signature verification
  (req as RequestWithRawBody).rawBody = body;
  // Always pass the raw body to the handler; let the handler parse JSON
  done(null, body);
});

app.get('/health', async () => {
  return healthStatus();
});

app.post('/webhooks/payments', async (request, reply) => {
  const rawBody = (request as RequestWithRawBody).rawBody.toString();
  const signatureHeader = request.headers['x-signature'] as string | undefined;

  const verification = verifySignature(config.webhookSecret, signatureHeader, rawBody);
  if (!verification.valid) {
    logger.warn(
      { event_id: 'unknown', type: 'webhook_rejected', reason: verification.error },
      'Webhook rejected',
    );
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

    logger.info({ event_id: eventId, type: 'payment.succeeded' }, 'Webhook accepted');
    return reply.code(200).send({ status: 'accepted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(
      { event_id: eventId, type: 'payment.succeeded', err: error },
      'Webhook processing failed',
    );
    return reply.code(500).send({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

async function start() {
  try {
    await app.listen({ port: config.ingestPort, host: '0.0.0.0' });
    logger.info({ port: config.ingestPort }, 'Server started');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
