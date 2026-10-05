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

Users can read shared data, upload, edit evidence, create/run jobs, cancel their own runs, and manage their personal ScrapeGraph key and loading controls. Admins also manage accounts, rules, provider settings, deletions, and all cancellations. The last administrator cannot be deleted or demoted. Login attempts and simultaneous password hashing are bounded.

## API changes

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`; admin CRUD `/api/users`.
- `POST /api/catalog` is atomic import-only and returns `{inserted, skipped}`. Existing SKUs are not overwritten. `PUT /api/catalog/:sku` accepts evidence edits and returns the saved row, or `404`.
- `DELETE /api/data` atomically clears catalog and jobs, including their history. All deletion endpoints require admin; affected queued/running runs cause `409` until cancellation finishes.
- `GET/PUT /api/provider-settings` exposes non-secret settings; only admins can write. `POST /api/chat` accepts optional `modelName` and `purpose: "qa" | "scrapper"` (default `"qa"`) as admin. Test API checks the displayed QA model, including unsaved edits, without saving it. The legacy scrapper purpose remains accepted for older clients but is unrelated to URL retrieval. Both purposes send a short connectivity prompt independent of QA instructions/result validation and browsing. Each result appears inline and in the existing Notifications menu. Explicit draft models can be tested without reading saved configuration. Credentials remain server-side. Browser provider keys, destinations and arbitrary model payloads are rejected.
- `POST /api/scrape` accepts `{url}` only and returns `{markdown}`, or `{error, code}` on failure. All retrieval calls the hosted ScrapeGraph v2 API using personal credentials. The app validates public URLs and their DNS results; ScrapeGraph manages redirects and page loading. Limits are 120 seconds per retrieval, 60 seconds upstream fetch time, 4 MiB response bytes, and 200,000 output characters including the source line. Empty, malformed and recognizable verification results fail.
- `GET /api/scraper-settings` returns `{configured, mode, stealth, wait, scrolls}` for the signed-in user. `PUT` accepts the four loading controls and optional write-only `apiKey`; omitting it preserves the saved key, while `null` removes it. Unsupported fields and invalid ranges are rejected. Keys are stored in users and excluded from session/user/settings responses, logs and snapshots. These routes derive ownership from the session and are available to ordinary users.
- `POST /api/scraper-settings/test` accepts `{apiKey}` for an unsaved draft or `{}` for the saved key and returns `{remaining, used, plan}` using the no-credit-cost credits endpoint. Invalid upstream credentials return 502 rather than expiring the application session; insufficient credits return 402 and rate limits return 429.
- `POST /api/jobs/:id/runs` accepts `{requestId, mode, sku?}`. Use a stable random UUID for retries; mode is `unfinished`, `all`, or `single` (requires `sku`). There is one active run per job. `GET /api/jobs/:id/runs` lists history; `GET /api/job-runs/:id` returns progress and saved snapshots/results. `POST /api/job-runs/:id/cancel` requests cancellation.
- `GET /healthz` is minimal public readiness; `/api/db-status` is authenticated schema readiness.

Mutation clients must send the configured origin and a valid session cookie, including command-line clients. Development derives the forwarded HTTPS origin from trusted Codespaces environment variables when APP_ORIGIN is unset; local development uses the request origin. An explicit APP_ORIGIN always takes precedence, and production still requires it. Production cookies are Secure, HttpOnly, and SameSite=Strict. Caddy's Basic authentication remains separate; it is not an application role.

## Execution and limits

One worker holds a dedicated PostgreSQL advisory lock and processes one SKU at a time. Job database transactions retry serialization/deadlock conflicts at most three times after successful rollback, without repeating model calls. Known provider configuration failures remain actionable; a failed progress refresh after an accepted run is reported separately and does not undo the queued job. Configuration and evidence snapshots, actor, timestamps, attempts, and results are persisted. A worker losing its connection aborts; writes also check its ownership token. Evidence revisions prevent late results from replacing edited catalog evidence. Run history remains available for exports even after later runs or evidence edits.

QA has three total attempts for transient network failures, 408, 429, and selected 5xx statuses. Attempt counts are saved before dispatch, including across restarts. Sanitized provider failures are saved before retries; exhausted recovery reports the last saved cause, or an interruption requiring a fresh rerun. Successful results clear transient failures. The default QA model is `deepseek/deepseek-v4.1-flash`, using low reasoning effort. Five minutes covers each SKU's execution, waits, and retries; elapsed restart downtime counts. A failed result save retries the database commit while retaining the provider response in memory. A process crash before the response is committed can cause another billable request; exactly-once billing is not promised. A scrape interrupted by a crash is not automatically repeated for that item; SAP evidence can still be used, otherwise rerun explicitly.

QA and model connectivity checks share two active requests and eight waiting slots with a 60-second queue wait; response deadlines begin after admission and the durable dispatch checkpoint (120 seconds for QA, 90 seconds for connectivity), with a 4 MiB cap. Provider errors are sanitized and never invalidate the app session. ScrapeGraph uses no local browser or admission queue and performs one API request per retrieval, without automatic retries. Interactive requests use the signed-in user’s saved configuration; the worker loads run.actor_id’s current configuration before every retrieval. Key/control changes affect subsequent requests, including queued jobs, while already-dispatched requests retain their original configuration. Jobs retain their QA configuration snapshots and SAP fallback. After key replacement, failed URLs can be scraped again through Dashboard. Model admission remains process-local: use shared admission before scaling backend replicas.

## Upgrade and verify

1. Keep a verified backup outside the repository and retain the prior image. Test these migrations on a restored copy before production.
2. Stop old browser-driven runs and deploy during a maintenance window; old clients must reload. Bootstrap server accounts and configure the server key/origin before reopening access.
3. Startup creates required application tables, adds nullable scrapegraph_api_key and default-empty scrapegraph_settings columns to users, and verifies indexes/constraints. Existing users must configure their key in Scrapper agent; existing evidence and job snapshots are preserved. Selector routes, configuration and runtime dependencies are retired. Existing selector data remains untouched; no destructive migration is performed.
4. Check `/healthz`, login/roles, import/edit, cancellation, and a controlled restart. Keep the gateway and other services unchanged. Rollback must account for new sessions/runs: the old application cannot operate durable runs or server accounts. Do not restore a shared database over newer data automatically.

```bash
npm test
TEST_DATABASE_URL=postgresql://... npm run test:security-db
TEST_DATABASE_URL=postgresql://... npm run test:qa-config-db
npm run setup:browser
npm run test:sap-editor
npm run build
```

Database checks create and drop isolated schemas; always use a disposable database. The UI test uses mocked APIs and standard Playwright Chromium installed through npm run setup:browser, or CHROMIUM_EXECUTABLE. On Linux, install missing system libraries with npx playwright-core install-deps chromium. ScrapeGraph and LLM responses are mocked; no API credits are consumed. Production does not include Playwright or Chromium. A live deployment, production-backup restoration, and paid-service retrieval remain operator release checks.

## Implementation validation

ScrapeGraphAI rebuild validated on 2026-10-05 with npm test, both disposable-PostgreSQL suites, the standard-Chromium UI check, and npm run build. Checks cover public URL/DNS validation, Markdown parsing, response/output limits, cancellation, upstream key/credit/rate-limit failures, personal key isolation and rotation, migration repeatability, background actor configuration, secret exclusion, saved controls, draft preservation, credit tests and React StrictMode loading. Provider traffic was mocked; no ScrapeGraph credits were consumed. A real ScrapeGraph v2 key was not supplied, so live hosted-service retrieval remains unverified.

The workspace backend was restarted to load the new routes and apply the additive user-column migrations to its configured database. Login and personal settings reads/saves returned HTTP 200 using the Codespaces forwarded HTTPS origin. Development now restarts the backend on server-code changes and recognizes that origin when APP_ORIGIN is unset. Origin regression checks cover local development, Codespaces ports, explicit overrides and continued cross-site rejection. No account passwords were changed or VPS deployment performed.

### Earlier releases (historical)

Browser retrieval validated on 2026-10-05 with `npm test`, `npm run test:scrape-browser`, `npm run test:sap-editor`, both disposable-PostgreSQL suites, and `npm run build`. The browser fixtures exercise delayed rendering, lazy scrolling, native and button disclosures, tabs, query preservation, redirects, empty/challenge pages, size/interaction limits, private HTTP/iframe/WebSocket requests, queue cancellation and browser cleanup. API/job checks verify retrieval without LLM credentials, preserved legacy snapshots, stored evidence and actionable browser failures without QA dispatch.

A separate production-build smoke test used a disposable database, local HTTPS gateway and temporary account with all provider credentials empty. Submitting the supplied Carrefour S25 Ultra URL through the actual UI returned 9,944 characters beneath the input, including the product title, 12 GB RAM, 256 GB storage, 5000 mAh battery, seller warranty and out-of-stock status. The original offer/seller query parameters remained in the source URL. The page's description also contains S24 Ultra wording; extraction preserves source text for QA instead of correcting it. The temporary database and account were removed. The workspace dev server was restarted and `/healthz` returned 200. No VPS deployment or VPS-origin retrieval was performed because deployment credentials are unavailable in this workspace; Docker-image execution remains a deployment check (no Docker engine here).

Scrapper agent replacement validated on 2026-10-01 with `npm test` (including TypeScript checks), production build, Chromium UI checks, shared QA database tests, and PostgreSQL security/job tests. Checks cover both draft model tests, persistence, source matching, unavailable content, cancellation, credential isolation, Dashboard saving, snapshotted job retrieval, legacy defaults and preserved selector data. Database tests used a disposable local PostgreSQL instance; provider responses were mocked. The initial live-check attempt stopped at missing `LLM_BASE_URL`/`LLM_API_KEY` configuration, before the legacy-key fallback below was implemented; real-provider retrieval remains unverified.

The API/job follow-up now accepts the existing server-only `AICREDITS_API_KEY` with its documented gateway when neither LLM override is set. Test API sends short prompts to both models and emits separate notifications; job transactions retry explicit serialization/deadlock failures, reuse their checked-out connection, and retain queued state when progress refresh fails. Development shutdown also closes Vite so restarts release its websocket port. Regression checks use mocked provider responses and a disposable database; no real-provider requests were made for this follow-up, so live retrieval remains unverified.

Validated locally on 2026-09-22: `npm test`, PostgreSQL security/recovery/failure-injection tests, shared QA configuration database tests, Chromium UI tests, frontend production build, server/bootstrap bundles, and a smoke test of the built production server. Tests used a disposable PostgreSQL 13 instance and fake provider responses. The built-server check covered first-admin bootstrap, Secure cookies, anonymous API rejection, static serving, concurrent selector conflicts, and rejection of browser-supplied provider credentials. Production infrastructure and provider accounts were not changed.
