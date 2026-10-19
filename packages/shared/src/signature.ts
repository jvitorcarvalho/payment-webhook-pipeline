import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 5 * 60;

export interface ParsedSignature {
  timestamp: number;
  signature: Buffer;
}

export function parseSignatureHeader(header: string | undefined): ParsedSignature | null {
  if (!header) {
    return null;
  }

  const parts = header.split(',');
  if (parts.length !== 2) {
    return null;
  }

  const tPart = parts[0]?.trim();
  const v1Part = parts[1]?.trim();

  if (!tPart?.startsWith('t=') || !v1Part?.startsWith('v1=')) {
    return null;
  }

  const timestampStr = tPart.slice(2);
  const signatureHex = v1Part.slice(3);

  const timestamp = Number.parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, 'hex');
  } catch {
    return null;
  }

  if (signature.length !== 32) {
    return null;
  }

  return { timestamp, signature };
}

export function isTimestampValid(timestamp: number, now: number = Date.now()): boolean {
  const ageSeconds = (now - timestamp * 1000) / 1000;
  return ageSeconds >= 0 && ageSeconds <= MAX_AGE_SECONDS;
}

export function computeSignature(secret: string, timestamp: number, rawBody: string): Buffer {
  const message = `${timestamp}.${rawBody}`;
  const key = Buffer.from(secret, 'utf8');
  const msg = Buffer.from(message, 'utf8');
  return createHmac('sha256', key).update(msg).digest();
}

export function verifySignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  now: number = Date.now(),
): { valid: boolean; error?: string } {
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return { valid: false, error: 'Invalid signature header format' };
  }

  if (!isTimestampValid(parsed.timestamp, now)) {
    return { valid: false, error: 'Timestamp too old' };
  }

  const expected = computeSignature(secret, parsed.timestamp, rawBody);

  if (!timingSafeEqual(parsed.signature, expected)) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}
