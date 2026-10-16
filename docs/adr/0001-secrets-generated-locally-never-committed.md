# 0001. Secrets are generated locally and never committed

## Context

The pipeline needs database and broker passwords for local development and for CI. Passwords
in git are hard to remove: a secret deleted in a later commit stays in the history. Developers
also need working local services right after cloning, without asking a teammate for a password.

## Decision

- `.env.example` holds only placeholders (`CHANGE_ME_POSTGRES`, `CHANGE_ME_RABBITMQ`).
- `scripts/gen-secrets.mjs` creates `.env` once, replacing each placeholder with 32 random bytes
  in base64url. It never overwrites an existing `.env`.
- `.env` is git-ignored. The `secrets-scan` CI job runs gitleaks over the full history, and
  `.gitleaks.toml` allowlists only the placeholders and fictional fixture values.
- `docker-compose.yml` reads the passwords from `.env` and refuses to start without them.
- CI uses one throwaway password, visible only inside the CI job.

## Consequences

- A clone is usable after one command (`npm run secrets`), with no shared password.
- A leaked local password is harmless outside the developer's machine.
- Each developer has a different password. Rotating a secret means deleting `.env` and
  running the script again. Postgres reads `POSTGRES_PASSWORD` only when it first initialises
  an empty volume, so the volume must be removed too (`docker compose down -v`).
- Any real secret added to a tracked file fails the gitleaks job, so the failure is visible in
  CI.
- The allowlist is a maintenance cost: a new fixture password must match an allowlist regex,
  which `scripts/test/gitleaks-allowlist.test.ts` enforces.
