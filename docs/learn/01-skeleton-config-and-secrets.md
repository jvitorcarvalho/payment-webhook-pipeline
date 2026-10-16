# Task 1: the skeleton, the local stack and the CI

## The problem

The pipeline receives payment webhooks. A `payment.succeeded` event for a fictional order
(Fictional Ltd, 49.90) carries customer data, and its signature is a credential. Three things
go wrong early in projects like this:

1. A service starts with a missing or malformed `DATABASE_URL` and fails hours later, on the
   first webhook.
2. Passwords get committed to git, and the history keeps them even after a later fix.
3. A log line captures the whole payload, card data included.

Task 1 lays the foundation against these three: the repository layout, a local PostgreSQL 16
and RabbitMQ 3 stack, a validated config loader, a redacting logger, and CI that blocks bad
changes.

## The decisions

- **Config fails at startup.** `packages/shared/src/config.ts` describes the environment with a
  zod schema. `loadConfig()` throws an error that names the bad variables. It never prints their
  values, because a value may be a password.
- **Secrets are generated on each machine.** `scripts/gen-secrets.mjs` reads `.env.example`,
  replaces each `CHANGE_ME_*` placeholder with 32 random bytes encoded as base64url, and writes
  `.env`. A placeholder used twice (inside `DATABASE_URL` and in `POSTGRES_PASSWORD`) gets one
  value, so the two stay consistent.
- **The script never overwrites.** It opens the file with flag `'wx'` (line 32), which creates
  the file only if it does not exist. The check and the write happen in one system call.
- **The logger redacts.** `packages/shared/src/logger.ts` lists `payload`, `signature` and the
  authorization header in pino's `redact` paths. A careless log call cannot leak them.
- **Local ports stay local.** `docker-compose.yml` binds every port to `127.0.0.1`. The compose
  file also refuses to start if `POSTGRES_PASSWORD` or `RABBITMQ_PASSWORD` is unset.

## Rejected alternatives

- **A committed `.env` with default passwords.** Every clone would share one password, and the
  secret would sit in git history. Rejected.
- **`process.env.DATABASE_URL!` with no validation.** The error appears at the first query,
  not at startup. Rejected: the requirement is to fail fast.
- **Check, then write** (`existsSync`, then `writeFile`). Two runs can both pass the check and
  then race to write. The `'wx'` flag closes that gap.
- **Trusting developers not to log payloads.** One `logger.info(event)` is enough to leak card
  data. The protection lives in the logger, not in each call site.

## How it is tested

The tests came first, one per case in the task's test design:

- `config_valida` and `config_sem_database_url [erro]`: `packages/shared/test/config.test.ts`.
- `gen_secrets_cria` and `gen_secrets_nao_sobrescreve [borda]`:
  `scripts/test/gen-secrets.test.ts`. The script runs as a child process in a temp directory,
  so the real `.env` is never touched.
- `scripts/test/gitleaks-allowlist.test.ts` checks that every password in the test fixtures
  matches an allowlist regex in `.gitleaks.toml`. Without this, the CI secrets job would fail
  on fixtures.
- `packages/shared/test/logger.test.ts` checks that the payload, the signature and the
  authorization header never reach the output.

`npm run check` runs typecheck, lint and the unit tests (see `package.json`). CI runs it on
Node 22 in `.github/workflows/ci.yml`, next to a gitleaks job with full history, CodeQL and
Dependabot.

**Honest limitation:** the `integration` job runs `npm run test:int`, but no
`*.int.test.ts` file exists yet, so the job passes with `--passWithNoTests`. It becomes a real
gate when the first database test lands.

## Break it yourself

1. Open `scripts/gen-secrets.mjs` and go to line 32. Change `flag: 'wx'` to `flag: 'w'`.
2. Run: `npx vitest run scripts/test/gen-secrets.test.ts`
3. Expected failure: `gen_secrets_nao_sobrescreve [borda]`. The test writes
   `KEEP_ME=existing-value` into `.env`, runs the script, and expects the file unchanged. With
   `'w'` the script overwrites the file instead of exiting, so the assertion fails. The
   `gen_secrets_cria` test still passes, because there is no existing file in its case.
4. Undo it: `git checkout -- scripts/gen-secrets.mjs`
