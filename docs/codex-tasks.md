# Codex task briefs

These are **two separate, independently usable tasks** for `cardiojunkie/Paxth_Q.A_Engine`. Copy either task, including its scope, steps, and acceptance criteria, into a new Codex session with this repository available. They are briefs, not already-running tasks or GitHub issues.

Evidence was gathered on 2026-09-16 at application commit `66d3ce35b9b33e6311fbfd3c5e4e69d6f512699e`. Recheck the current checkout before acting: code may have changed. The [analysis report](codebase-analysis.md) contains supporting detail, and the [README](../README.md) describes current operation.

## Task 1 — Remove verified dead code and repository artifacts

### Objective and boundaries

Remove all **verified dead code within the repository's application/build/test entrypoints**, obsolete source-rewrite scripts, unused direct dependencies, and tracked generated artifacts. Preserve active behavior and data compatibility. Finish with an evidence-based deletion summary and passing applicable checks; explicitly list uncertain candidates retained and why.

Use the smallest working change. Trace callers, imports, package scripts, dynamic loading, CSS plugins, type use, database tooling, and documentation before deleting. Do not execute historical rewrite scripts to find out whether they are needed. An exported helper with no external-looking name is not automatically live; a schema export or peer dependency with no direct import is not automatically dead.

Do not fix unrelated application bugs in this task. Do not remove validation, access controls, active UI features, API routes, database tables/columns, saved QA results, or legacy import paths. Do not run migrations, touch the shared database, rewrite Git history, push, publish, or deploy. Preserve unrelated workspace edits. Do not reproduce secrets or backup contents in reports.

### Concrete candidate inventory

| Candidate | Proposed action after verification | Preserve/check |
| --- | --- | --- |
| `fix_app_context.cjs`, `fix_app_context2.cjs`, `fix_dashboard.cjs`, `fix_settings.cjs` | Delete obsolete one-off source rewrites | Check repository/tooling references first |
| `rewrite_dashboard.cjs`, `update_app_context.cjs`, `update_dashboard_ui.cjs`, `update_hook.cjs`, `update_server.cjs`, `update_server.patch` | Delete stale rewrite/patch artifacts; all nine scripts plus the patch total 1,237 lines at baseline | Do not apply their embedded old code |
| Dashboard `exportQAExcel` and `downloadJSON` | Remove unreachable download implementations | Keep the active `exportToExcel` summary and Jobs detailed Excel exports |
| Dashboard unused `manualScrapeText` state, duplicate unused DB-status state/effect, unused imports/destructuring | Remove state/effects with no active consumer | Keep manual input queue/textarea, SAP editing, and the App-level database indicator |
| `useCatalogData.updateSkuStatus` and matching context type/destructuring/provider plumbing | Remove if still no consuming caller | Keep `updateSku`, source persistence, and server routes |
| `useSiteSelectors.matchUrlRule` | Remove if still unused | Keep server-side normalized domain matching and selector management |
| `scraperTimeout` type/default | Remove the unused setting | Do not change server timeout behavior or clear saved settings |
| Server Axios/`attributeSets` imports and compiler-reported unused icons/default imports | Remove unused bindings safely | Keep four arguments on Express error middleware; a parameter can be unused but required by the framework |
| Direct `@google/genai`, `motion`, `axios` dependencies | Uninstall if current runtime/build/tooling checks confirm they are unused; update npm lockfile together | Do not mass-remove dependencies using text search alone |
| `GEMINI_API_KEY` example variable and Gemini capability metadata | Remove the unused env example; remove metadata only after excluding an external hosting consumer | Preserve `metadata.json` if ownership/use remains uncertain |
| Duplicate Vite declaration and build/type-only dependency placement | Deduplicate/classify only with production/devcontainer build proof | Dynamic Vite import is used in development; production browser peer dependencies remain installed |
| `bun.lock` | Remove if npm remains the sole actual project workflow | Preserve `package-lock.json`; current Dockerfile uses `npm ci` |
| Tracked `node_modules`, `dist`, and database backup | Untrack generated files; securely retain backup first; extend ignore rules | Retain reproducible build inputs and the verified external backup |

The baseline compiler check reports 40 unused-code diagnostics; investigate beyond those diagnostics for unconsumed context exports and one-off scripts. Do not turn the cleanup into cosmetic edits to every callback parameter.

**Explicit non-deletions:**

- Dashboard's `error` state is written but not rendered: this is missing user feedback, assigned to Task 2. Do not remove the error handling to silence the unused-variable warning.
- Keep `playwright-core`: CloakBrowser uses it as a runtime peer. Keep `@tailwindcss/typography`, loaded from CSS, and used type packages even when text search finds no import.
- Keep both SheetJS (`xlsx`) and ExcelJS until a separate import/export compatibility change. They currently serve different active paths.
- Keep Users/Login until an authentication replacement is implemented; broken security is not equivalent to unreachable code.
- Keep schema exports, `attribute_set_id`, `export_data`, `raw_row.qa_result`, source header-order fallbacks, and legacy browser configuration imports unless a separate compatibility migration is approved. They are outside this behavior-preserving cleanup.
- Keep category mapping Markdown documents as maintained human reference material.

### Work sequence

1. Record Git status, current commit, tracked artifact counts, and baseline check results. Read applicable repository instructions. Trace the candidate paths from `src/main.tsx`, `server.ts`, package scripts, configuration, tests, and deployment files.
2. Create a deletion manifest with each candidate, reference evidence, expected behavior impact, and verification. Mark uncertainty explicitly; keep anything whose active use cannot be excluded.
3. Before untracking the database dump, copy it to an access-restricted path outside the repository/build context, verify a matching checksum, and record the retained path without exposing contents. Use an existing secured backup location when available. If no retained copy can be established, leave the dump untouched and finish independent cleanup.
4. Untrack `node_modules` and `dist` without relying on their checked-in copies. Untrack the backup only after step 3. Add ignore rules for dependency/build/cache outputs and backups; preserve the `.env.example` exception. Do not delete unrelated local artifacts or erase history.
5. Remove confirmed dead source/scripts and update dependency declarations plus the npm lockfile. Avoid lockfile-wide upgrades unrelated to removal. Do not use `npm audit fix --force`.
6. Check a clean temporary checkout with `npm ci`, build, and relevant tests. Check the container's production install/browser launch when Docker is available. This is essential before claiming a peer/build dependency is removable.
7. Update affected documentation to describe the resulting source, and report deleted lines/files/direct dependencies, retained candidates, checks, and remaining limitations. Do not claim historical Git size has shrunk merely because files are untracked.

### Verification and acceptance

Run the existing focused checks rather than adding a new test framework:

```bash
npm run lint
npm run test:job-state
npm run test:site-selector
npm run test:blocked-page
npm run test:db-error
npm run test:lazy-content
npm run test:llm-response
npm run test:qa-agent
npm run build
```

With verified browser prerequisites, run `test:tab-capture` and `test:sap-editor`. Run `test:qa-config-db` only against a disposable `TEST_DATABASE_URL`; the test creates/drops an isolated schema. Never use the shared production database. Report any unavailable prerequisite as unverified, not passed.

Use `npx --no-install tsc --noEmit --noUnusedLocals --noUnusedParameters` as an audit, not a requirement to delete necessary handler parameters or the broken upload-error path. Remaining diagnostics need an explicit reason. Smoke-check upload/duplicate handling, manual Markdown, SAP edits, selector rules, shared memory/rule import, job run/stop/rerun, and both active Excel export layouts using fixtures/mocked services; no paid LLM call is required.

Completion requires:

- Every candidate classified as removed or retained with evidence; no known reachable feature deleted.
- Clean `npm ci` and build work after generated files are untracked. If a runtime dependency change cannot be validated, retain that dependency and explain the limitation.
- The tracked file set excludes generated dependencies/builds and, after verified retention, the backup. Ignore rules prevent recurrence; existing history is unchanged.
- All applicable checks pass or a specific environmental blocker is recorded. Existing QA/source/export compatibility is preserved.
- The final diff and deletion manifest are reviewable. No deployment, migration, external issue, or push occurs.

## Task 2 — Prioritized improvements roadmap

### Objective and boundaries

Review the recommendations below against the current repository and produce an implementation-ready improvement backlog, grouped by security, persistence, job reliability, database lifecycle, dependency maintenance, usability/accessibility, performance, and operations. Include every item, with priority, evidence, consequence, smallest implementation direction, prerequisites, and acceptance checks. Mark stale findings as resolved with evidence rather than silently dropping them.

The deliverable is a roadmap, not automatic implementation of the entire backlog. Write it to `docs/improvements-roadmap.md`, link it from the README, and keep application/schema/deployment changes for individually selected follow-up work. The existing analysis is supporting evidence; the requirements below are sufficient to start this task independently. Do not create GitHub issues, deploy, or contact services/users as part of preparing it.

Use existing Express, React, Drizzle, PostgreSQL, Node APIs, and test tools first. No framework rewrite, generic persistence layer, new queue service, or speculative infrastructure. Keep backend workers, immutable run history, pagination, and virtualization conditional on an established requirement or measurement.

Priority meanings: P1 = access/data/release reliability before expanded use; P2 = the next maintenance pass; P3 = conditional work. IDs match the analysis so no recommendation is lost.

### Security and dependency maintenance

- **F01 — P1: Enforce real access control.** Context/Login use hardcoded defaults and plaintext localStorage passwords/roles; Express routes do not authenticate requests. First verify Caddy authentication and loopback bindings. For the existing multi-user feature, plan server-validated sessions, hashed credentials, and role checks using PostgreSQL, removal of embedded defaults, and retirement of local password storage. Address any credential reuse without printing values. **Depends on:** confirming current access needs and existing account migration constraints. **Accept when:** direct unauthenticated API calls fail; regular users cannot invoke admin actions; logout revokes access; assets contain no shipped credentials; session/CSRF handling is covered.
- **F02 — P1: Restrict outbound requests and API exposure.** `/api/scrape` and `/api/chat` accept destinations chosen by the caller; CORS is unrestricted. Plan HTTP(S) validation, private/link-local address restrictions across DNS, redirects, IPv4/IPv6, and browser subresources, with explicit trusted exceptions for required private LLM endpoints. Restrict CORS and resource/body limits. **Depends on:** inventory of legitimate destinations, not assumptions about a public-only LLM. **Accept when:** controlled internal/redirect fixtures are rejected, allowed product/provider requests work, and no generic proxy bypass remains.
- **F09 — P1: Triage audited dependencies without breaking spreadsheet support.** Baseline audit has eight affected entries: high `xlsx`; moderate `qs`, `uuid`/ExcelJS, and nested esbuild/drizzle-kit chains. Audit counts are not exploit counts. Evaluate maintained patched distributions/compatible upgrades, distinguish runtime from tooling exposure, and reject blind forced downgrades. **Depends on:** supported `.xlsx`/`.xls`/CSV and annotated export fixtures. **Accept when:** audit is rerun, remaining risks are documented, supported imports/exports and schema tooling pass, and there is no silent format regression.
- **F10 — P1 backup handling / P2 hygiene; F11 — P2 cleanup.** Delegate verified dead-code and generated-file removal to Task 1; track its outcome here. Git currently contains roughly 385 MB of installed dependencies, stale builds, and a database backup. Preserve/verify an external secured backup before untracking, and do not rewrite history. **Depends on:** Task 1 evidence and backup retention. **Accept when:** cleanup's clean-install/build proof and retained-candidate list are linked; no active feature/schema/compatibility was deleted. Investigate backup exposure separately if repository access/history makes that necessary.

### Persistence correctness and database lifecycle

- **F03 — P1: Make UI mutations reflect database outcomes.** Catalog/job mutations and selector deletion often optimistically change state without checking HTTP status. Clear-all spans independent operations. Plan awaited typed results and confirmed UI updates/explicit rollback, plus a transactional clear operation where the UI promises all-or-nothing behavior. **Depends on:** endpoint failure semantics from F07. **Accept when:** 400/503/network and partial-clear failures show errors, retain consistent data, and never emit false success.
- **F04 — P1: Retain paid QA output until it is saved.** Jobs ignores `updateSku`'s boolean, counts processed rows after failed saves, and some manual-source controls advance without awaiting writes. Trace every caller and propagate failure; separate retrying persistence from invoking the model again. **Depends on:** F03's mutation contract. **Accept when:** a result-save failure retains the model result, does not mark completion, and saves on retry without an additional model request; source drafts remain available on failure.
- **F06 — P1: Establish complete, versioned schema upgrades and readiness.** Startup never creates base `sku_data`, performs partial DDL, and health checks only `SELECT 1`. Use existing Drizzle tooling to baseline/upgrade new and legacy databases without losing data. Separate migrations from serving requests and expose schema readiness. **Depends on:** a disposable representative database, external verified backups, and a migration compatibility review. **Accept when:** fresh setup, legacy upgrade, repeated startup, and failed migration are covered; saved rules/deletions persist; failure never advertises ready.
- **F07 — P1: Validate API contracts and make batches atomic.** Validate arrays, IDs, enums, numeric bounds, and JSON bodies; consistently return 400/404/409; sanitize DB errors and use transactions for promised batches. Use explicit TypeScript result/request types alongside runtime checks, without a generic validation framework unless existing tools cannot cover the actual cases. **Depends on:** current caller inventory and compatibility tests. **Accept when:** malformed/unknown requests are rejected predictably and a middle-of-batch failure does not partially persist data.
- **F12 — P2, history conditional P3: Clarify evidence freshness and result ownership.** Source edits intentionally preserve original upload cells and old results; results are copied into multiple fields and old jobs export current catalog data. Plan visible “rerun needed” state and a canonical read contract while retaining legacy fallbacks. Immutable per-run snapshots require a separate confirmed history requirement. **Depends on:** F03/F04; schema changes, if any, use F06. **Accept when:** source changes cannot masquerade as a current review, old records remain readable, and reruns/exports preserve original cells. Test historical export stability only if snapshots are selected.
- **F15 — P2: Make category comparisons and selector uniqueness consistent.** Grouping/export compares raw category names while QA trims/ignores case. Selector duplicate checks lack a DB constraint. Normalize comparisons without rewriting original display values; add normalized-domain uniqueness after reviewing duplicates. **Depends on:** existing duplicate inventory and F06 migration process. **Accept when:** case/space variants behave consistently and concurrent selector creates yield one record plus a conflict, without silently discarding rules.

### Job execution and request budgets

- **F05 — P1: Give runs stable ownership and recovery.** Execution/stop state belongs to JobsModule, which unmounts on navigation; reload loses orchestration and two clients can run the same job. First keep run controls/ownership at a stable app level, guarantee finalization on failure, and reconcile interrupted records. Use a DB claim for multi-client execution. Add a server worker using PostgreSQL only if runs must survive closed browsers. **Depends on:** F03/F04 and F06 for persisted ownership changes. **Accept when:** navigation, reload, interruption, and two-client starts do not create hidden duplicate work; unfinished SKUs remain resumable.
- **F08 — P1: Bound retry cost, deadlines, and browser concurrency.** Up to four client attempts can each cause three upstream attempts; permanent 4xx can be retried; the timeout is cleared before response-body consumption; each scrape starts another browser. Plan one documented total budget, transient-error retries, targeted provider-format fallback, full-body deadlines, and bounded browser admission with disconnect cleanup. **Depends on:** F02 network policy and F05 stop semantics. **Accept when:** simulated 400/429/503, hanging bodies, disconnects, and simultaneous scrapes have bounded calls/time/memory and release their resources.

### Usability, import/export, and accessibility

- **F13 — P2: Show upload errors and skipped-row counts.** Dashboard sets errors for empty/corrupt/no-SKU files but does not render them. Display an accessible error/summary at the upload control; preserve previous data and distinguish parse success from persistence success. **Depends on:** F03 for truthful save notifications. **Accept when:** empty, malformed, unreadable, missing-SKU, and duplicate-row fixtures produce specific visible outcomes.
- **F14 — P2: Correct the active summary export.** Its `missing`/`mapping` classifications do not match the current QA contract. Count `missing_data`, replace “Mapping Errors” with “Data Mismatch Count” using `data_mismatch`, and prefer canonical results with the old-record fallback. **Depends on:** existing output fixtures; coordinate with F12. **Accept when:** every supported issue type has correct workbook totals and detailed Jobs export remains unchanged.
- **F16 — P2: Make configuration controls reflect actual behavior.** Selector fetch failures silently fall back to local data; late settings hydration can replace a dirty draft; saving provider settings also requires shared-memory persistence. Provider labels also imply native API support although every call uses OpenAI-compatible chat completions. Show cache/load state, prevent hydration from overwriting edits, document the combined-save dependency, and label only supported transport without adding speculative adapters. Split saves only if independent provider editing is required. **Depends on:** F03 and existing legacy-config behavior. **Accept when:** slow/offline loads never erase edits or imply shared success; failed saves preserve drafts; imports preserve existing nonblank rules; provider choices match the protocol while retaining saved keys/endpoints.
- **F17 — P2: Define spreadsheet edge cases and size bounds.** Default row parsing can coerce identifiers; numeric SKU zero is skipped by a truthy check; no file/row limits or duplicate-header policy exists. Preserve text identifiers, reject ambiguous headers visibly, and choose limits from representative catalog sizes. **Depends on:** F09 parser decision and F13 feedback. **Accept when:** leading zeros, numeric zero, blank/duplicate headers, duplicates, empty sheets, all three formats, and oversized files have deterministic tested behavior. Streaming/workers remain conditional on measurement.
- **F19 — P2: Use native accessible controls.** Unlabelled/read-only checkboxes depend on wrapper clicks, many labels are not associated with inputs, and several modals have no dialog/focus behavior. Reuse the existing native SAP dialog approach, real checkbox change handlers, and input/button labels. **Depends on:** inventory of affected active views. **Accept when:** keyboard-only workflows have accessible names, correct selection, contained/restored focus, Escape handling, and announced errors without color dependence.

### Performance and maintainability

- **F18 — P2 bundle loading, P3 scale work.** The measured initial JS is approximately 1.8 MB (540 kB gzip); all modules and spreadsheet libraries are eager. Defer spreadsheet imports to upload/export actions and use a SKU `Map` for repeated lookup where appropriate. Measure full-catalog transfer/render/memory before adding pagination, indexes, or virtualization. Split large components only when extracting a responsibility needed by a selected fix. **Depends on:** stable import/export fixtures and representative dataset sizes. **Accept when:** first/repeated actions work, bundle output improves, and any scale claim includes before/after measurements. Do not add caching or a state library speculatively.

### Operations, CI, and automatic deployment

- **F20 — P1 release safeguards, P2 automation.** There is no checked-in Actions workflow, aggregate test command, Compose healthcheck, or release identity. npm is used by Docker, but a Bun lockfile also exists. `npm start` needs `NODE_ENV=production` outside Docker. Standardize npm, group existing fast checks, and run clean-install/typecheck/test/build CI. Add schema-aware readiness and a visible deployed commit/image identity. **Depends on:** F06 readiness/migrations and clean builds proven by Task 1. **Accept when:** checks fail the pipeline correctly, clean builds are reproducible, and a running release can be matched to its source.

The deployment part of F20 must include the following concrete release contract:

1. **Current topology (inspected 2026-09-17):** copied source at `/opt/paxth-qa` without `.git`; Compose project `paxth-qa`; image `paxth-qa:local`; Express at `127.0.0.1:3200`; Caddy Basic authentication at `127.0.0.1:8082`; `https://project22.tail608e42.ts.net/` through `tailscaled-project22.service` and `/run/tailscale-project22/tailscaled.sock`. Rakazo has separate containers and uses the default Tailscale service; preserve it and the existing legacy port-8443 QA route.
2. **Manual baseline:** push the tested branch, transfer source from the exact commit, build and smoke-test an image, then replace only the QA app with `docker compose up -d --no-build --no-deps app`. Preserve host secrets, Compose, and gateway files, and record the deployed commit. Funnel does not deploy Git commits. Save the previous source/image and verify an external database backup before updates. Never use `tailscale serve reset`.
3. **Trigger:** recommend successful checks on the explicitly selected production branch, plus manual dispatch for a selected commit. Discover the actual default/production branch during setup; do not assume a name. Failed checks must block deployment, and untrusted pull-request runs must not receive production secrets.
4. **Transport:** recommend a GitHub-hosted runner with restricted Tailscale access and SSH to the VPS; pin the host key and keep deployment credentials in a GitHub environment. Use the existing trusted SSH route if one already exists. Do not install a broad-access runner on the public app merely to avoid configuring deployment access.
5. **Artifact:** build and deploy the exact tested commit or immutable image, record its identity, and serialize production deployments. Avoid deploying whatever branch tip happens to exist when a delayed job runs. Keep secrets out of logs/build context and do not replace the host's `.env`.
6. **Upgrade:** preserve gateway/listener and loopback settings, coordinate with active browser runs, apply only reviewed compatible migrations with backup/restore evidence, then replace the app container. Automatic schema rollback is excluded.
7. **Verification and rollback:** check process and schema/config readiness, application/asset/API access through the gateway, deployed identity, and port-443 service continuity. Retain the previous compatible image and restore it if app health fails; report deployment failures and leave incompatible DB changes for the documented recovery procedure. Do not restore a shared database over newer data automatically.
8. **Acceptance scenarios:** bad commit blocked by CI; two rapid pushes do not overlap deployment; healthy tested commit appears live; unhealthy release returns to its compatible predecessor; missing/wrong gateway credentials still fail; unrelated services and database data survive. Include a documented manual recovery path if deployment connectivity is lost.

### Roadmap output and completion criteria

Write a prioritized backlog with one entry per F01–F20 or explicitly grouped entries that retain all requirements. For each, include evidence paths, priority/rationale, minimal implementation direction, expected public API/type/schema changes (or “none”), prerequisites, acceptance tests, and rollout/backward-compatibility notes. Keep recommended changes separate from current behavior.

Use this order: immediate access/dependency and save-integrity fixes; job/schema/request reliability; independent cleanup; import/export/configuration/accessibility; measured performance. Put CI/release safeguards early and enable automatic deployment only after readiness and rollback are trustworthy. When a choice depends on an unknown live-host or product fact, name that fact, give a recommended default, and mark the individual item as requiring it before implementation; do not invent values or block the whole roadmap.

Completion requires all 20 findings accounted for, no duplicated cleanup work, explicit regression checks, and clearly identified conditional larger changes. Recheck new advisory/version claims when writing the roadmap. No paid LLM calls or production database access are needed to prepare it. The final response must link the roadmap and state that application changes and deployment remain future work.
