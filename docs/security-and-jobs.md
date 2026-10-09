# Server authentication and durable jobs

The app is under development in GitHub Codespaces and has not been deployed. Production and upgrade guidance here is for future installations.

This release replaces browser-owned accounts, keys, and execution. The explicit first-admin bootstrap defaults to username `Aswath` and password `potusdown@2230`. Startup does not automatically create accounts or reset existing passwords.

## Configure and bootstrap

Set `DATABASE_URL` (direct connection or **session** pooler, not transaction pooler) and the server-only `AICREDITS_API_KEY`. URL scraping also requires `CRAWL4AI_API_KEY`; both configurations are checked before a paid scrape. With neither LLM override set, the key uses `https://aicredits.in/v1`, the same-provider route verified as reachable from this Codespace. For another OpenAI-compatible destination, set both `LLM_BASE_URL` and `LLM_API_KEY`; a partial override fails rather than mixing the AI Credits key with another destination. Redirects are rejected to prevent forwarding the shared credential to another endpoint. A future production installation also requires `APP_ORIGIN` (the exact HTTPS browser origin), an HTTPS gateway, and an appropriate backend binding.

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

Users can read shared data, upload, edit evidence, create/run jobs, cancel their own runs, and retrieve public pages through Crawl4AI cloud and the Markdown cleanup model. Admins also manage accounts, rules, provider settings, deletions, and all cancellations. The last administrator cannot be deleted or demoted. Login attempts and simultaneous password hashing are bounded.

## API changes

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`; admin CRUD `/api/users`.
- `POST /api/catalog` is atomic import-only and returns `{inserted, skipped}`. Existing SKUs are not overwritten. `PUT /api/catalog/:sku` accepts evidence edits with `expectedRevision` and returns the saved row; missing SKUs return `404`, stale revisions `409`.
- `DELETE /api/data` atomically clears catalog and jobs, including their history. All deletion endpoints require admin; affected queued/running runs cause `409` until cancellation finishes.
- `GET/PUT /api/provider-settings` exposes non-secret QA settings; only admins can write. Admin `POST /api/chat` accepts optional `modelName` and `purpose: "qa"` or `"scrape"`, tests the displayed model including unsaved edits, and never saves it. Retired navigation purposes and browser-supplied provider keys/destinations are rejected. Results appear inline and in Notifications; credentials remain server-side.
- `POST /api/catalog/:sku/scrape` accepts only `{expectedRevision}`, retrieves the SKU's saved URL, and returns its committed catalog row. Retrieval runs outside the mutation transaction; saving checks the revision again. A newer edit, deletion, or scrape cannot silently be overwritten. `/api/scrape` and personal scraper-settings routes are retired. [Cloud configuration, limits, and boundaries](browser-scraper.md).
- `POST /api/scrape/preview` accepts only `{url}` for **Test URL** without a SKU. It requires the normal session/origin protections and returns temporary cleaned Markdown, requested URL, receipt time, nullable final URL/capture time, and diagnostics. Hard failures return sanitized errors/codes and available diagnostics without Markdown. It writes no catalog/jobs/runs and uses the separately selected scraping model to structure Markdown. Copy/download remain browser actions; there is no saved history.
- Successful retrieval stores cleaned Markdown, cloud/formatter provenance, requested URL, receipt time, and an incremented revision. Unknown final URL/capture time stay null. Failure stores a separate `scrape_error` while preserving earlier evidence. Manual Markdown works without a URL; URL evidence from an older URL is excluded from QA. `qa_revision` and derived `qa_stale` prevent old reviews/usage appearing as current while preserving historical exports.
- `POST /api/jobs/:id/runs` accepts `{requestId, mode, sku?}`. Use a stable random UUID for retries; mode is `unfinished`, `all`, or `single` (requires `sku`). There is one active run per job. `GET /api/jobs/:id/runs` lists history; `GET /api/job-runs/:id` returns progress and saved snapshots/results. `POST /api/job-runs/:id/cancel` requests cancellation.
- `GET /healthz` is minimal public readiness; `/api/db-status` is authenticated schema readiness.

Mutation clients must send the configured origin and a valid session cookie, including command-line clients. Development derives the forwarded HTTPS origin from trusted Codespaces environment variables when APP_ORIGIN is unset; local development uses the request origin. Codespaces can rewrite Origin and Host to localhost; with no explicit APP_ORIGIN, development also accepts matching loopback Origin/Host when Sec-Fetch-Site is exactly same-origin. Missing or cross-site metadata does not qualify for this exception. An explicit APP_ORIGIN always takes precedence, and production still requires it. Production cookies are Secure, HttpOnly, and SameSite=Strict. If a future installation adds gateway Basic authentication, it remains separate from application roles.

## Execution and limits

One worker holds a dedicated PostgreSQL advisory lock and processes one SKU at a time. Job database transactions retry serialization/deadlock conflicts at most three times after successful rollback, without repeating model calls. Known provider configuration failures remain actionable; a failed progress refresh after an accepted run is reported separately and does not undo the queued job. Configuration and evidence snapshots, actor, timestamps, attempts, and results are persisted. A worker losing its connection aborts; writes also check its ownership token. Evidence revisions prevent late results from replacing edited catalog evidence. URL-only SKUs can create jobs: missing current web evidence is retrieved and committed to the run snapshot and matching catalog revision before QA starts. QA failure or cancellation therefore retains successful scraping. A revision conflict keeps evidence in that run only. Failed scraping may use SAP; without either source the item fails. Run history remains available for exports even after later runs or evidence edits.

QA has three total attempts for transient network failures, 408, 429, and selected 5xx statuses. Attempt counts are saved before dispatch, including across restarts. Sanitized provider failures are saved before retries; exhausted recovery reports the last saved cause, or an interruption requiring a fresh rerun. Successful results clear transient failures. The default QA model is `deepseek/deepseek-v4.1-flash`, using low reasoning effort. Five minutes covers each SKU's execution, waits, and retries; elapsed restart downtime counts. A failed result save retries the database commit while retaining the provider response in memory. A process crash before the response is committed can cause another billable request; exactly-once billing is not promised. A scrape interrupted by a crash is not automatically repeated for that item; SAP evidence can still be used, otherwise rerun explicitly.

QA, Markdown cleanup and connectivity checks share two active model requests and eight waiting slots. URL previews, SKU scraping, and jobs share cloud admission: one active, eight waiting, 60-second queue wait, and a 120-second retrieval deadline. Public input and initial DNS are validated before the cloud call. The API performs page navigation remotely; no local browser/proxy remains. Both keys stay server-side and are sent only to their respective providers. API redirects, malformed/unsuccessful/empty/oversized responses are rejected. Cloud collection has no automatic retries. Cloud admission is released before cleanup; bounded model retries reuse its Markdown. Cleanup has a separate 120-second deadline inside the existing five-minute job budget. Invalid/refused/truncated cleanup never replaces saved evidence. QA retains its own snapshotted model. [Cloud configuration and verification](browser-scraper.md).

## Upgrade and verify

The cloud integration requires no database schema migration. Configure `CRAWL4AI_API_KEY` and model credentials, then release server/client assets together and reload clients. Saved settings, browser/manual/legacy evidence, retired columns, and historical run snapshots remain readable. `scraperConfigured` is a read-only key-presence boolean, not a successful connectivity check. Verify anonymous/wrong-origin rejection, temporary previews, cancellation, and failed cleanup with prior evidence preserved. Local Python, Chromium retrieval, and proxy installation have been removed; UI browser tests still use Playwright.

1. Keep a verified backup outside the repository and retain the prior image. Test these migrations on a restored copy before production.
2. Stop old browser-driven runs and deploy during a maintenance window; old clients must reload. Bootstrap server accounts and configure the server key/origin before reopening access.
3. Startup adds scraping provenance/error and QA-revision fields, initializes legacy evidence without invented timestamps, scrubs retired navigation settings, and verifies indexes/constraints. Existing evidence, retired credential columns, selector data, and job snapshots remain untouched; fresh installations do not create or require retired user columns.
4. Check `/healthz`, login/roles, import/edit, cancellation, and a controlled restart. In any future deployed installation, preserve unrelated gateway and service configuration. Rollback must account for new sessions/runs: the old application cannot operate durable runs or server accounts. Do not restore a shared database over newer data automatically.

```bash
npm test
TEST_DATABASE_URL=postgresql://... npm run test:security-db
TEST_DATABASE_URL=postgresql://... npm run test:qa-config-db
npm run setup:browser
npm run test:sap-editor
npm run build
```

Database checks create and drop isolated schemas; always use a disposable database. The UI test uses mocked APIs and standard Playwright Chromium installed through npm run setup:browser, or CHROMIUM_EXECUTABLE. On Linux, install missing system libraries with npx playwright-core install-deps chromium. UI and provider responses are mocked; no API credits are consumed. Production retrieval uses native fetch; see [current cloud configuration](browser-scraper.md). A future deployment requires backup restoration and retrieval checks on the chosen host.
