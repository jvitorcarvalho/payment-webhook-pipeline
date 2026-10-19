#!/usr/bin/env node
// Creates .env from .env.example with fresh random passwords.
// Run once after cloning: `npm run secrets`.
// It never overwrites an existing .env. To get new secrets, delete .env yourself first.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each placeholder in .env.example is replaced by one random secret.
// The same placeholder used in two variables (for example inside a URL) gets the same
// value, so DATABASE_URL and POSTGRES_PASSWORD stay consistent.
const PLACEHOLDERS = ['CHANGE_ME_POSTGRES', 'CHANGE_ME_RABBITMQ', 'CHANGE_ME_WEBHOOK'];

function randomSecret() {
  // 32 random bytes become 43 characters. base64url uses only URL-safe characters.
  return randomBytes(32).toString('base64url');
}

async function generateEnvFile(rootDir) {
  const example = await readFile(join(rootDir, '.env.example'), 'utf8');

  let content = example;
  for (const placeholder of PLACEHOLDERS) {
    content = content.replaceAll(placeholder, randomSecret());
  }

  try {
    // flag 'wx' creates the file only if it does not exist. The check and the write
    // happen in one system call, so two runs cannot overwrite each other.
    // mode 0o600: on Unix, only the owner can read the secrets.
    await writeFile(join(rootDir, '.env'), content, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.log('.env already exists, nothing changed.');
      return;
    }
    throw error;
  }
  console.log('.env created with random secrets.');
}

// Runs only when executed directly (`node scripts/gen-secrets.mjs`), not when imported.
// An optional first argument points to another root directory; the tests use it.
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  const rootDir = process.argv[2] ?? join(dirname(scriptPath), '..');
  await generateEnvFile(rootDir);
}
