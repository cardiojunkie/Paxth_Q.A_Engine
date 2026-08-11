# Paxth QA Engines

Paxth QA Engine validates ecommerce catalogue rows against SAP/source data and public product pages. It imports `.xlsx` workbooks, runs one durable server-side QA job at a time, and exports the results.

The production shape is intentionally small: one Node 24 process, one CloakBrowser session, managed PostgreSQL, and Caddy. PostgreSQL owns job state, mapping rules, selectors, and encrypted LLM settings; closing the browser tab does not stop a queued job.

## Requirements

- Node.js 24 LTS
- npm
- PostgreSQL
- A licensed, pinned CloakBrowser binary for scraping
- An OpenAI-compatible HTTPS `/chat/completions` endpoint

Only `.xlsx` input is supported. A workbook must have a header row and a unique, non-empty SKU column. `attributes__*` columns are values under test; `source__sap` and `source__url` are source truth.

## Local development

Install dependencies and create an admin password record:

```bash
npm ci
read -rsp 'Admin password: ' PAXTH_ADMIN_PASSWORD; printf '\n'
printf '%s\n' "$PAXTH_ADMIN_PASSWORD" | npm run auth:hash
unset PAXTH_ADMIN_PASSWORD
```

Create an untracked `.env` using the runtime and migration entries in [.env.example](.env.example). Use `PUBLIC_ORIGIN=http://127.0.0.1:3000` locally, then run migrations explicitly before starting the app:

```bash
npm run db:migrate:dev
npm run dev
```

The server does not create or alter tables during startup. LLM credentials saved in Settings are encrypted in PostgreSQL with `SETTINGS_ENCRYPTION_KEY`; they are never persisted client-side or returned by the API.

## Checks

```bash
npm run lint
npm test
npm audit --omit=dev --audit-level=moderate
npm run build
npm start
```

Production output is `dist/public` plus the ESM entrypoint `dist/server/server.js`. `PORT` defaults to 3000 and may be overridden.

## VPS deployment

Production images are built by GitHub Actions and published to `ghcr.io/cardiojunkie/paxth-qa-engine`. Deploy an immutable digest through the included Compose stack; do not publish the Node port or build on the VPS.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for VPS sizing, DNS/firewall rules, secrets, deployment, backup, restore, monitoring, and rollback procedures.
