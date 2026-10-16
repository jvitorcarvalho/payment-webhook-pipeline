import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

// Collects everything the logger writes, one JSON line per entry.
function captureLogs() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { destination, output: () => lines.join('') };
}

describe('createLogger', () => {
  it('writes JSON with the service name and keeps event_id and type', () => {
    const logs = captureLogs();
    const logger = createLogger({ service: 'ingest-api', level: 'info', destination: logs.destination });

    logger.info({ event_id: 'evt_example_1', type: 'payment.succeeded' }, 'webhook accepted');

    const entry = JSON.parse(logs.output()) as Record<string, unknown>;
    expect(entry).toMatchObject({
      service: 'ingest-api',
      event_id: 'evt_example_1',
      type: 'payment.succeeded',
      msg: 'webhook accepted',
    });
  });

  it('never writes the payload or the signature, even when a caller passes them', () => {
    const logs = captureLogs();
    const logger = createLogger({ service: 'ingest-api', level: 'info', destination: logs.destination });

    logger.info(
      {
        event_id: 'evt_example_2',
        payload: { card_number: '4000000000000000', customer: 'Fictional Ltd' },
        signature: 'sig-example-secret-value',
        headers: { authorization: 'Bearer token-example-secret-value' },
      },
      'webhook received',
    );

    const output = logs.output();
    expect(output).toContain('evt_example_2');
    expect(output).not.toContain('4000000000000000');
    expect(output).not.toContain('Fictional Ltd');
    expect(output).not.toContain('sig-example-secret-value');
    expect(output).not.toContain('token-example-secret-value');
  });
});
