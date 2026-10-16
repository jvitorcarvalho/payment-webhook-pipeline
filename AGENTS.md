# Rules for coding agents in this repository

1. Tests first. Write the failing test for each case of the task's test design, then the code. Keep commits small and in that order.
2. Never create, read or print real secrets. Use `.env.example` placeholders; real values come from `scripts/gen-secrets.mjs` at runtime.
3. Fictional data only. No real company, person, document number, phone or e-mail (use `example.com`).
4. Do not run `git push`, change remotes, or touch anything outside this repository.
5. Do not add dependencies outside the plan without writing why in the commit message.
6. Logs: JSON via pino; log `event_id` and type, never full payloads or signatures.
7. Before finishing: `npm run check` must pass, plus `npm run test:int` when the task touches the database or the broker. Report the real command output.
8. Code and comments in English. Clear names over clever code: this repository is also teaching material.
