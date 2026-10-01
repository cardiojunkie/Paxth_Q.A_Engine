# Server authentication and durable jobs

This release replaces browser-owned accounts, keys, and execution. The explicit first-admin bootstrap defaults to username `Aswath` and password `potusdown@2230`. Startup does not automatically create accounts or reset existing passwords.

## Configure and bootstrap

Set `DATABASE_URL` (direct connection or **session** pooler, not transaction pooler), `APP_ORIGIN` (the exact browser origin; HTTPS is required in production), `LLM_BASE_URL` and `LLM_API_KEY` on the server. Keep the existing gateway and loopback binding. The public provider URL must support OpenAI-compatible chat completions. When neither LLM override is set, the existing server-only `AICREDITS_API_KEY` uses `https://api.aicredits.in/v1`; a partial override fails rather than mixing a legacy key with another destination. Redirects are rejected to prevent forwarding the shared credential to another endpoint.

Create the first administrator locally against the intended database with the defaults:

```bash
npm run admin:bootstrap
```

To override the defaults, set the bootstrap environment variables:

```bash
read -r -p 'Administrator username: ' BOOTSTRAP_ADMIN_USERNAME
read -r -s -p 'Administrator password (12–256 characters): ' BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD
npm run admin:bootstrap
unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD
```

For a built container, run `node dist/bootstrap-admin.mjs` with those same environment variables and the database connection. The command refuses to replace a usable administrator. If the database contains only unusable legacy plaintext administrators, explicitly pass `--recover-legacy` to create/reset the chosen account. The normal Users screen supports creating accounts, resetting passwords, and roles. Passwords are never readable after saving. Sessions expire after eight hours and are revoked on account changes.

Users can read shared data, upload, edit evidence, create/run jobs, and cancel their own runs. Admins also manage accounts, rules, provider settings, deletions, and all cancellations. The last administrator cannot be deleted or demoted. Login attempts and simultaneous password hashing are bounded.

## API changes

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`; admin CRUD `/api/users`.
- `POST /api/catalog` is atomic import-only and returns `{inserted, skipped}`. Existing SKUs are not overwritten. `PUT /api/catalog/:sku` accepts evidence edits and returns the saved row, or `404`.
- `DELETE /api/data` atomically clears catalog and jobs, including their history. All deletion endpoints require admin; affected queued/running runs cause `409` until cancellation finishes.
- `GET/PUT /api/provider-settings` exposes non-secret settings; only admins can write. `POST /api/chat` accepts optional `modelName` and `purpose: "qa" | "scrapper"` (default `"qa"`) as admin. One Test API button independently tests both displayed model IDs, including unsaved edits, without saving them. Both purposes send a short connectivity prompt independent of QA instructions/result validation and browsing. Each result appears inline and in the existing Notifications menu. Explicit draft models can be tested without reading saved configuration. Credentials remain server-side. Browser provider keys, destinations and arbitrary model payloads are rejected.
- `POST /api/scrape` accepts `{url}` only, using the server key and separate shared `scrapperModelName` (default `perplexity/sonar`). Dashboard and jobs use the same retrieval helper; jobs use their snapshotted model, with older snapshots defaulting to Sonar.
- `POST /api/jobs/:id/runs` accepts `{requestId, mode, sku?}`. Use a stable random UUID for retries; mode is `unfinished`, `all`, or `single` (requires `sku`). There is one active run per job. `GET /api/jobs/:id/runs` lists history; `GET /api/job-runs/:id` returns progress and saved snapshots/results. `POST /api/job-runs/:id/cancel` requests cancellation.
- `GET /healthz` is minimal public readiness; `/api/db-status` is authenticated schema readiness.

Mutation clients must send `Origin: <APP_ORIGIN>` and a valid session cookie, including command-line clients. Production cookies are Secure, HttpOnly, and SameSite=Strict. Caddy's Basic authentication remains separate; it is not an application role.

## Execution and limits

One worker holds a dedicated PostgreSQL advisory lock and processes one SKU at a time. Job database transactions retry serialization/deadlock conflicts at most three times after successful rollback, without repeating model calls. Known provider configuration failures remain actionable; a failed progress refresh after an accepted run is reported separately and does not undo the queued job. Configuration and evidence snapshots, actor, timestamps, attempts, and results are persisted. A worker losing its connection aborts; writes also check its ownership token. Evidence revisions prevent late results from replacing edited catalog evidence. Run history remains available for exports even after later runs or evidence edits.

QA has three total attempts for transient network failures, 408, 429, and selected 5xx statuses. Attempt counts are saved before dispatch, including across restarts. Sanitized provider failures are saved before retries; exhausted recovery reports the last saved cause, or an interruption requiring a fresh rerun. Successful results clear transient failures. The default QA model is `deepseek/deepseek-v4.1-flash`, using low reasoning effort. Five minutes covers each SKU's execution, waits, and retries; elapsed restart downtime counts. A failed result save retries the database commit while retaining the provider response in memory. A process crash before the response is committed can cause another billable request; exactly-once billing is not promised. A scrape interrupted by a crash is not automatically repeated for that item; SAP evidence can still be used, otherwise rerun explicitly.

All model callers share two active requests and eight waiting slots with a 60-second queue wait limit; request/body timers begin after admission and the durable dispatch checkpoint, allowing 120 seconds for QA and 90 seconds for other callers, with a 4 MiB cap. Each retrieval makes one bounded native-search request with a 120-second overall deadline and public URL/DNS validation. The gateway must preserve the supplied-URL search filter and source metadata. Nonempty complete content and exact URL citations (including query parameters) are required; unavailable content, refusals, truncation, missing citations and outside sources fail visibly. Provider errors are sanitized; an upstream key rejection does not invalidate the app session. Retrieval usage is not included in QA token totals. Admission is process-local: use a shared limiter before scaling backend replicas.

## Upgrade and verify

1. Keep a verified backup outside the repository and retain the prior image. Test these migrations on a restored copy before production. No production database was accessed during implementation.
2. Stop old browser-driven runs and deploy during a maintenance window; old clients must reload. Bootstrap server accounts and configure the server key/origin before reopening access.
3. Startup creates required application tables and verifies indexes/constraints. Selector routes, configuration and runtime dependencies are retired. Existing selector data remains untouched; no destructive migration is performed.
4. Check `/healthz`, login/roles, import/edit, cancellation, and a controlled restart. Keep the gateway and other services unchanged. Rollback must account for new sessions/runs: the old application cannot operate durable runs or server accounts. Do not restore a shared database over newer data automatically.

```bash
npm test
TEST_DATABASE_URL=postgresql://... npm run test:security-db
TEST_DATABASE_URL=postgresql://... npm run test:qa-config-db
npm run test:sap-editor
npm run build
```

Database checks create and drop isolated schemas; always use a disposable database. Browser tests use mocked APIs and an installed browser. Set `CHROMIUM_EXECUTABLE` to an installed Chromium binary, or use the existing CloakBrowser installation. Tests use fake provider responses and incur no LLM charges. Real-provider testing requires configured server credentials and is also available through Test API. A live deployment and production-backup restoration remain operator release checks.

## Implementation validation

Scrapper agent replacement validated on 2026-10-01 with `npm test` (including TypeScript checks), production build, Chromium UI checks, shared QA database tests, and PostgreSQL security/job tests. Checks cover both draft model tests, persistence, source matching, unavailable content, cancellation, credential isolation, Dashboard saving, snapshotted job retrieval, legacy defaults and preserved selector data. Database tests used a disposable local PostgreSQL instance; provider responses were mocked. The initial live-check attempt stopped at missing `LLM_BASE_URL`/`LLM_API_KEY` configuration, before the legacy-key fallback below was implemented; real-provider retrieval remains unverified.

The API/job follow-up now accepts the existing server-only `AICREDITS_API_KEY` with its documented gateway when neither LLM override is set. Test API sends short prompts to both models and emits separate notifications; job transactions retry explicit serialization/deadlock failures, reuse their checked-out connection, and retain queued state when progress refresh fails. Development shutdown also closes Vite so restarts release its websocket port. Regression checks use mocked provider responses and a disposable database; no real-provider requests were made for this follow-up, so live retrieval remains unverified.

Validated locally on 2026-09-22: `npm test`, PostgreSQL security/recovery/failure-injection tests, shared QA configuration database tests, Chromium UI tests, frontend production build, server/bootstrap bundles, and a smoke test of the built production server. Tests used a disposable PostgreSQL 13 instance and fake provider responses. The built-server check covered first-admin bootstrap, Secure cookies, anonymous API rejection, static serving, concurrent selector conflicts, and rejection of browser-supplied provider credentials. Production infrastructure and provider accounts were not changed.
