import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The script is tested as a black box: run it as a child process on a temp directory.
// The temp directory holds a copy of the real .env.example, so the test never touches
// the repository's own .env.
const SCRIPT = fileURLToPath(new URL('../gen-secrets.mjs', import.meta.url));
const REPO_EXAMPLE = fileURLToPath(new URL('../../.env.example', import.meta.url));

// Parses KEY=VALUE lines into a map. Comments and blank lines are skipped.
function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) values[match[1] ?? ''] = match[2] ?? '';
  }
  return values;
}

describe('gen-secrets', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gen-secrets-'));
    copyFileSync(REPO_EXAMPLE, join(dir, '.env.example'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const runScript = () => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

  it('gen_secrets_nao_sobrescreve [borda]: exits without changing an existing .env', () => {
    writeFileSync(join(dir, '.env'), 'KEEP_ME=existing-value\n');

    const result = runScript();

    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('KEEP_ME=existing-value\n');
  });

  it('gen_secrets_cria: creates .env with random secrets, none equal to the example', () => {
    const result = runScript();
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, '.env'))).toBe(true);

    const generated = readFileSync(join(dir, '.env'), 'utf8');
    const example = parseEnv(readFileSync(join(dir, '.env.example'), 'utf8'));
    const env = parseEnv(generated);

    // No placeholder survives in the generated file.
    expect(generated).not.toMatch(/CHANGE_ME/);

    // Every secret placeholder is present and replaced. Plain settings such as LOG_LEVEL stay.
    for (const [key, exampleValue] of Object.entries(example)) {
      expect(env[key], key).toBeDefined();
      if (exampleValue.includes('CHANGE_ME')) {
        expect(env[key], key).not.toBe(exampleValue);
      }
    }

    // Passwords are at least 32 characters, and the URL carries the same Postgres password.
    expect(env['POSTGRES_PASSWORD']?.length).toBeGreaterThanOrEqual(32);
    expect(env['RABBITMQ_PASSWORD']?.length).toBeGreaterThanOrEqual(32);
    expect(env['DATABASE_URL']).toContain(env['POSTGRES_PASSWORD'] ?? '<missing>');
    expect(env['AMQP_URL']).toContain(env['RABBITMQ_PASSWORD'] ?? '<missing>');
  });
});
