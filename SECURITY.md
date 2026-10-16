# Security policy

This is a study project with fictional data. Still:

- No secret is committed. `scripts/gen-secrets.mjs` creates a local `.env` with random values; `.env` is git-ignored.
- CI runs gitleaks, CodeQL and Dependabot.
- Logs never include full payloads or signatures.

Found a problem? Open a private security advisory on GitHub (Security tab → Report a vulnerability). Please do not open a public issue for vulnerabilities.
