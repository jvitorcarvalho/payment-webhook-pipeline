import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Gitleaks flags the password of every URL that carries credentials. Each password in the
// test fixtures must match one regex of the allowlist in .gitleaks.toml, or the secrets
// job fails. The check reports file names only, never the passwords.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_DIRS = ['packages/shared/test', 'scripts/test'];

function allowlistRegexes(): RegExp[] {
  const toml = readFileSync(join(ROOT, '.gitleaks.toml'), 'utf8');
  const regexesBlock = toml.slice(toml.indexOf('regexes = ['));
  return [...regexesBlock.matchAll(/'''(.+?)'''/g)].map((match) => new RegExp(match[1] ?? ''));
}

function passwordsIn(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/:\/\/[^:/@\s]+:([^@\s'"]+)@/g)].map((match) => match[1] ?? '');
}

describe('gitleaks allowlist', () => {
  it('covers the password of every URL in the test fixtures', () => {
    const allowed = allowlistRegexes();
    const filesWithUncoveredPassword = FIXTURE_DIRS.flatMap((dir) =>
      readdirSync(join(ROOT, dir))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(ROOT, dir, name)),
    )
      .filter((file) =>
        passwordsIn(file).some((password) => !allowed.some((regex) => regex.test(password))),
      )
      .map((file) => file.slice(ROOT.length));

    expect(filesWithUncoveredPassword).toEqual([]);
  });
});
