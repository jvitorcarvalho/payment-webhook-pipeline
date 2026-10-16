import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.js';

// Fields that must never reach the logs. A payload holds customer data and a signature
// is a credential. Log event_id and type instead: they are enough to trace an event.
// Pino replaces these values with the censor text, so a careless log call cannot leak them.
const REDACTED_PATHS = [
  'payload',
  'signature',
  '*.payload',
  '*.signature',
  'headers.authorization',
  'headers["x-signature"]',
];

export interface LoggerOptions {
  service: string;
  level: LogLevel;
  // Defaults to stdout. Tests pass a stream they can read back.
  destination?: DestinationStream;
}

// One JSON object per line. The timestamp is ISO 8601, so log tools sort it correctly.
export function createLogger({ service, level, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
    destination ?? process.stdout,
  );
}
