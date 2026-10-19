import { describe, expect, it } from 'vitest';
import {
  parseSignatureHeader,
  isTimestampValid,
  computeSignature,
  verifySignature,
} from '../src/signature.js';

const SECRET = 'test-secret-key-for-hmac';

describe('parseSignatureHeader', () => {
  it('returns timestamp and signature for valid header', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '{"event_id":"evt_test_1","amount":100}';
    const signature = computeSignature(SECRET, timestamp, rawBody).toString('hex');
    const header = `t=${timestamp},v1=${signature}`;

    const result = parseSignatureHeader(header);

    expect(result).not.toBeNull();
    expect(result?.timestamp).toBe(timestamp);
    expect(result?.signature.toString('hex')).toBe(signature);
  });

  it('returns null for undefined header', () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
  });

  it('returns null for empty header', () => {
    expect(parseSignatureHeader('')).toBeNull();
  });

  it('returns null for malformed header (missing comma)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '{}';
    const signature = computeSignature(SECRET, timestamp, rawBody).toString('hex');
    expect(parseSignatureHeader(`t=${timestamp} v1=${signature}`)).toBeNull();
  });

  it('returns null for malformed header (missing t=)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '{}';
    const signature = computeSignature(SECRET, timestamp, rawBody).toString('hex');
    expect(parseSignatureHeader(`x=${timestamp},v1=${signature}`)).toBeNull();
  });

  it('returns null for malformed header (missing v1=)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '{}';
    const signature = computeSignature(SECRET, timestamp, rawBody).toString('hex');
    expect(parseSignatureHeader(`t=${timestamp},x1=${signature}`)).toBeNull();
  });

  it('returns null for non-hex signature', () => {
    expect(parseSignatureHeader('t=1234567890,v1=nothex')).toBeNull();
  });

  it('returns null for wrong signature length', () => {
    expect(parseSignatureHeader('t=1234567890,v1=abc')).toBeNull();
  });
});

describe('isTimestampValid', () => {
  const now = Date.now();

  it('returns true for current timestamp', () => {
    const timestamp = Math.floor(now / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(true);
  });

  it('returns true for timestamp 1 minute ago', () => {
    const timestamp = Math.floor((now - 60_000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(true);
  });

  it('returns true for timestamp 4 minutes 59 seconds ago (within boundary)', () => {
    const timestamp = Math.floor((now - 4 * 60_000 - 59_000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(true);
  });

  it('returns false for timestamp 5 minutes and 1 second ago', () => {
    const timestamp = Math.floor((now - 5 * 60_000 - 1000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(false);
  });

  it('returns false for timestamp 10 minutes ago', () => {
    const timestamp = Math.floor((now - 10 * 60_000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(false);
  });

  it('returns true for timestamp 1 second in the future (sender clock slightly ahead)', () => {
    const timestamp = Math.floor((now + 1000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(true);
  });

  it('returns true for timestamp 4 minutes 59 seconds in the future (within tolerance)', () => {
    const timestamp = Math.floor((now + 4 * 60_000 + 59_000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(true);
  });

  it('returns false for timestamp 5 minutes and 1 second in the future', () => {
    const timestamp = Math.floor((now + 5 * 60_000 + 1000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(false);
  });

  it('returns false for timestamp 10 minutes in the future', () => {
    const timestamp = Math.floor((now + 10 * 60_000) / 1000);
    expect(isTimestampValid(timestamp, now)).toBe(false);
  });
});

describe('computeSignature', () => {
  it('produces deterministic output for same inputs', () => {
    const timestamp = 1_700_000_000;
    const rawBody = '{"event_id":"evt_test_1"}';

    const sig1 = computeSignature(SECRET, timestamp, rawBody);
    const sig2 = computeSignature(SECRET, timestamp, rawBody);

    expect(sig1).toEqual(sig2);
  });

  it('produces different output for different secrets', () => {
    const timestamp = 1_700_000_000;
    const rawBody = '{"event_id":"evt_test_1"}';

    const sig1 = computeSignature(SECRET, timestamp, rawBody);
    const sig2 = computeSignature('different-secret', timestamp, rawBody);

    expect(sig1).not.toEqual(sig2);
  });

  it('produces different output for different timestamps', () => {
    const rawBody = '{"event_id":"evt_test_1"}';

    const sig1 = computeSignature(SECRET, 1_700_000_000, rawBody);
    const sig2 = computeSignature(SECRET, 1_700_000_001, rawBody);

    expect(sig1).not.toEqual(sig2);
  });

  it('produces different output for different bodies', () => {
    const timestamp = 1_700_000_000;

    const sig1 = computeSignature(SECRET, timestamp, '{"a":1}');
    const sig2 = computeSignature(SECRET, timestamp, '{"a":2}');

    expect(sig1).not.toEqual(sig2);
  });
});

describe('verifySignature', () => {
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);
  const rawBody = '{"event_id":"evt_test_1","amount":100}';
  const validHeader = `t=${timestamp},v1=${computeSignature(SECRET, timestamp, rawBody).toString('hex')}`;

  it('returns valid for correct signature and timestamp', () => {
    const result = verifySignature(SECRET, validHeader, rawBody, now);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns invalid for tampered signature', () => {
    const tamperedHeader = `t=${timestamp},v1=${'0'.repeat(64)}`;
    const result = verifySignature(SECRET, tamperedHeader, rawBody, now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature');
  });

  it('returns invalid for tampered body', () => {
    const tamperedBody = '{"event_id":"evt_test_1","amount":999}';
    const result = verifySignature(SECRET, validHeader, tamperedBody, now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature');
  });

  it('returns invalid for timestamp 10 minutes old', () => {
    const oldTimestamp = Math.floor((now - 10 * 60_000) / 1000);
    const oldRawBody = '{"event_id":"evt_test_1","amount":100}';
    const oldSignature = computeSignature(SECRET, oldTimestamp, oldRawBody).toString('hex');
    const oldHeader = `t=${oldTimestamp},v1=${oldSignature}`;

    const result = verifySignature(SECRET, oldHeader, oldRawBody, now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Timestamp too old');
  });

  it('returns invalid for missing header', () => {
    const result = verifySignature(SECRET, undefined, rawBody, now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature header format');
  });

  it('returns invalid for malformed header', () => {
    const result = verifySignature(SECRET, 'not-a-valid-header', rawBody, now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature header format');
  });
});
