# Codebase review: quality, architecture, scaling, and deployment

Reviewed **6 October 2026**, against checkout `f3a7125e` before the documentation changes in this review. Scope: application source, runtime configuration, schema initialization, tests, Docker/Compose, launcher, and operational documentation. Secrets were not printed. No production database, remote host, deployment, account, or paid provider was changed.

The app is currently under development in GitHub Codespaces and has not been deployed. Deployment readiness below concerns a future release.

**Follow-up:** the QA import/result trust finding below is fixed in the current source. The original ratings and audit counts describe the initial review; they have not been recalculated. Remaining findings are outside this fix. Legacy raw-only and snapshot-only reviews require explicit reruns rather than automatic promotion.

## Assessment

**This is a workable internal catalog-review application with thoughtful backend recovery safeguards, but it is not ready for an unrestricted production release or substantial growth without targeted changes.** Keep the modular monolith. The QA trust boundary is now fixed; address credentials and dependencies next, then data transfer and queue throughput as demand grows.

These are engineering judgments on a 10-point scale, not benchmark scores or a security certification. A 10 would mean the relevant behavior is maintainable, measured, tested under realistic conditions, and operationally verified.

| Area | Rating | Reason |
| --- | --- | --- |
| Overall code quality | **6/10** | Useful separation and meaningful checks, weakened by permissive types, large UI modules, duplicated representations, and confirmed correctness gaps |
| Architecture for a shared internal tool | **7/10** | A single React/Express/PostgreSQL app is appropriate; durable runs and ownership safeguards are valuable |
| Scalability as implemented | **4/10** | One serial worker, shared write lock, full catalog/progress payloads, polling proportional to all jobs, and local admission limits |
| Deployment readiness | **4/10** | Build and packaging work; QA integrity, bootstrap credentials, dependencies, and unverified integration/release checks prevent approval |
| Test and verification coverage | **6/10** | Good fast tests and existing integration scripts; missing automated release gating and current DB/browser/live verification |

For a limited internal deployment, the code has a reasonable foundation once the high-priority findings are resolved and the actual installation is smoke-tested. For a public multi-organization product, tenant isolation and a different resource-admission policy are additional requirements. More replicas alone would not make this version scalable.

## What was checked in the initial review

| Check | Result in this review |
| --- | --- |
| `npm test` | Passed: current TypeScript check and all included fast scripts |
| `npm run build` | Passed: frontend, server, and administrator bundles |
| `tsc --noEmit --strict` | Failed with **11 diagnostics**; current project does not enable strict mode |
| `npm run test:sap-editor` | Could not launch Chromium: missing `libglib-2.0.so.0`; no UI assertions executed |
| `test:security-db`, `test:qa-config-db` | Not run: no disposable PostgreSQL service or `TEST_DATABASE_URL` was available |
| `npm audit` | **13 affected packages:** 1 critical, 3 high, 9 moderate |
| `npm audit --omit=dev` | **9 affected packages:** 1 critical, 3 high, 5 moderate |
| QA-result import trust reproduction | Confirmed using existing validation/mapping/state functions, without DB writes |
| Attribute-edit/template reproduction | Confirmed using `prepareQaInput`, without DB writes |
| Docker build/run | Not verified; no Docker executable was available |
| Live model/ScrapeGraph | Not tested; no paid calls performed |
| `.env` protection | Real `.env` is ignored and not currently tracked; example configuration is tracked |

Node was **22.23.3**, npm **10.9.9**. The build emitted one frontend JS asset of approximately **1,777 KB minified / 533 KB gzip**, and Vite's large-chunk warning. Audit counts are time-sensitive package findings, not 13 proven exploitable application vulnerabilities. Re-run audits after any lockfile changes.

Earlier deployment claims in operational documents were incorrect and have been removed. This review covers the Codespaces checkout. Current `.env` exclusion is not a forensic guarantee about Git history or credentials stored outside the workspace.

### QA integrity follow-up validation

The fix passed `npm test`, `npm run build`, the PostgreSQL security suite, the shared QA configuration database suite, and the existing browser suite. The new fast catalog regression is included in `npm test`. The security suite verifies forged-batch rejection, an explicit unfinished rerun using a mocked provider, trusted skipped results, preserved legacy storage/history, and unchanged recovery/cancellation/revision/idempotency behavior. Excel round-trip checks verify raw-only reviews supply no corrections or notes while genuine pass/warning/fail results keep their behavior. Browser checks verify unverified snapshots show the rerun explanation, hide forged findings, and do not enter issues-only exports.

The database suites used a temporary local PostgreSQL 15 instance and isolated schemas. Missing browser libraries and fonts were provided in a temporary runtime directory; APIs were mocked. No new app dependency, production database access, destructive migration, paid provider call, or deployment was needed. Vite still emits its existing large-bundle warning. Target-host, Docker, and live-provider checks remain outstanding; the initial ratings and unrelated findings above are unchanged.

## Findings, ordered by action priority

Priority definitions: **P0** blocks trusting QA output; **P1** should be resolved or explicitly mitigated before broad production access; **P2** addresses growing-load or maintenance problems; **P3** is a smaller usability/cleanup issue.

### P0 — Imported nested QA results could impersonate completed reviews — fixed

Evidence: [`validateCatalogImport` and `mapCatalogRow`](../src/server/catalog.ts), [`hasCompletedQa`](../src/lib/jobRunState.ts), and run creation in [`jobRunner.ts`](../src/server/jobRunner.ts).

**Original defect:** import validation forbade top-level `qa_result` but permitted `raw_row.qa_result`. Catalog mapping, completion selection, UI, and exports trusted that nested value. An importer could therefore supply a review that an unfinished run skipped without a server review.

**Implemented correction:** every own `raw_row.qa_result` property is rejected, regardless of value, with HTTP 400 before opening the batch transaction. Top-level QA metadata and processed import states remain rejected. Catalog results come exclusively from the dedicated database column; nested raw metadata is excluded from response projections. Completed-review selection requires canonical QA, no error, and status `completed` or `failed`. Genuine failing reviews remain completed reviews.

Run snapshots now supply evidence only. Their QA/export/usage metadata cannot establish completion or supply exports. Existing durable run-item results remain trusted. New skipped items save a trusted prior review into the existing result field, without counting its tokens again. Workers no longer copy generated QA into original raw rows. History and legacy raw data remain stored; later catalog edits do not erase genuine historical results.

Regression checks, from the repository root:

```bash
npm run test:catalog
npm run test:job-state
# Point only to a disposable PostgreSQL instance:
TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/paxth_qa_test' npm run test:security-db
# Requires Chromium and its system libraries:
npm run test:sap-editor
```

**Legacy behavior:** raw-only catalog reviews and older snapshot-only history expose no trusted verdict, correction, or finding. They show `Legacy review is unverified; rerun QA.` unless an existing error is more meaningful. Unverified completed catalog rows become `ready` when they have SAP, Markdown, or a URL, otherwise `cannot_qa`. They are excluded from issues-only exports and selected by fresh unfinished runs. Status `completed` alone also cannot prove a review. No destructive migration, new tables/dependencies, automatic promotion, or automatic paid reruns were introduced.

**Rollout:** finish or cancel active runs; retain a verified database backup and previous release; deploy and reload browser clients. Check a rejected forged batch, normal import, unfinished legacy rerun, and genuine export before restoring normal access. The remaining findings below are unchanged.

### P1 — First-admin bootstrap can use a publicly known password

Evidence: [`scripts/bootstrap-admin.ts`](../scripts/bootstrap-admin.ts) and [`.env.example`](../.env.example).

Both username and password have hardcoded fallbacks, and the example configuration documents them. Hashing that password does not make a known password private. An operator following the old default setup can create a predictable administrator account.

This does not establish that any existing account uses that password; bootstrap refuses to overwrite an administrator with a usable hash. The risk is unsafe new-account provisioning.

**Smallest fix:** require explicit bootstrap credentials and fail when absent. Until then, always override both values. Rotate any account provisioned with the fallback. The rewritten README uses temporary explicit credentials and does not repeat the password.

### P1 — Dependencies need remediation, with reachability considered

Evidence: [package manifest](../package.json), [lockfile](../package-lock.json), and the current npm audit results.

| Package/path | Finding | Application relevance |
| --- | --- | --- |
| `xlsx@0.18.5` | High: prototype pollution and ReDoS; no npm-registry fix reported | Dashboard directly parses uploaded spreadsheets with `XLSX.read`, so untrusted input reaches the affected parser in the browser |
| Express → `proxy-addr@2.0.7` | Critical advisory; patched version 2.0.8 | The advisory requires a problematic proxy-trust subnet configuration; this app does not enable `trust proxy` and uses socket addresses for login throttling, so the described bypass is not demonstrated here |
| ExcelJS/archive chain → `brace-expansion` | High recursion/CPU exhaustion advisories | Review the affected library calls; a flagged dependency is not proof that upload contents reach its glob parser |
| Tailwind/Vite → `source-map-js@1.2.1` | High source-map processing advisory | Build tooling is included in production dependencies, but production request paths do not run Vite |
| `qs`, `uuid`, PostCSS selector parser, Drizzle tooling | Moderate direct/transitive findings | Assess each affected API; avoid indiscriminate major upgrades/downgrades |

SheetJS's own advisories identify the affected input-reading behavior and remediation releases for [prototype pollution](https://cdn.sheetjs.com/advisories/CVE-2023-30533) and [ReDoS](https://cdn.sheetjs.com/advisories/CVE-2024-22363). The [proxy-addr maintainer advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h) explains its configuration-dependent impact and patched version.

**Smallest fix:** prioritize the reachable spreadsheet parser; use a supported patched distribution while preserving XLS/XLSX/CSV compatibility, or deliberately change formats if the product permits it. Reuse ExcelJS only after checking those requirements—it does not automatically replace every supported importer. Refresh patchable transitive dependencies and review the resulting lockfile. Move build-only tools out of the runtime dependency group. Do not use `npm audit fix --force` blindly: some proposed remedies are unrelated major-version changes or downgrades.

### P1 — Successful sign-ins can exhaust a global login budget

Evidence: [`registerAuth`](../src/server/auth.ts), particularly `totalAttempts`, the increment before password verification, and the successful-login cleanup.

Every validated login attempt increments a process-wide count. Success removes the per-key entry but does not reduce that global count. The 101st login within the 15-minute window receives 429 even if every preceding login succeeded. Malicious failures can also exhaust the shared budget and deny legitimate sign-ins.

Per-user keys use `req.socket.remoteAddress`, which usually identifies the reverse proxy. The limiter is not shared between replicas, and restarting a process clears it. The two-active-hash cap is a sensible memory safeguard and should remain.

**Smallest fix:** separate abusive-attempt throttling from a bound on concurrent expensive hashing. Apply appropriately scoped admission at the trusted ingress, or in shared storage when replicas are used. Trust forwarded addresses only after configuring the exact proxy boundary. Add a successful-login budget regression.

### P1 — Large JSON is parsed before authentication/origin checks

Evidence: [`server.ts`](../server.ts): `express.json({ limit: '50mb' })` is installed before the auth middleware.

Anonymous requests can make the application buffer and parse large JSON before their session or origin is rejected. Concurrent requests can pressure the one-CPU, 1.5 GiB container. The spreadsheet row-count limit is checked after parsing and does not bound that earlier work.

A future gateway requiring authentication could reduce exposure, but gateway configuration is absent here. The route order itself is confirmed; a denial-of-service load experiment was not performed.

**Smallest fix:** use small default body limits and a larger authenticated limit only for import. Bound request concurrency/body size at ingress as well. Keep import row/content limits after parsing. No general-purpose validation framework is needed for that change.

### P2 — Full-data APIs and per-job polling amplify load

Evidence: [catalog routes](../src/server/catalog.ts), [run reads](../src/server/jobRunner.ts), [Jobs polling](../src/components/JobsModule.tsx), [catalog hook](../src/hooks/useCatalogData.ts), [Dashboard table](../src/components/DashboardModule.tsx).

`GET /api/catalog` selects every row and includes source text, Markdown, and QA data. Jobs polls every job's entire history, active-run details, and the full catalog/jobs every two seconds. A selected run has another timer. These timers continue on the Jobs screen even when no run is active.

A run detail response sends every item's snapshot/result. Dashboard renders every filtered row. Each job card resolves SKU membership with repeated `.find()` over the catalog. There is no server pagination, summary/detail separation, or table windowing.

**Smallest fix:** paginated catalog summaries with an on-demand SKU detail endpoint; one compact active-run summary fetch; poll only changing/relevant data; paginated history/details. Use a `Map` for repeated SKU lookup. Add UI windowing only if rendering remains a measured problem after pagination.

### P2 — Serialized writes and a serial worker cap throughput

Evidence: [`database.transaction`](../src/server/database.ts), [`jobRunner.transaction` and `startJobWorker`](../src/server/jobRunner.ts), and row-by-row import/run-item inserts.

Catalog, job-definition, provider-setting, and run-state transactions share advisory key `73462190`. The worker holds session advisory key `73462191` while executing a run. Large imports and run starts perform thousands of sequential database calls while holding the shared mutation lock.

Adding app replicas still leaves one worker across the database. Larger jobs execute fully before the next job is selected. This is a deliberate, documented simplification, not an inherently bad choice for low-volume operation. It becomes a hard ceiling when required work exceeds serial capacity.

**Smallest fix:** bulk bounded imports/run-item inserts first; measure lock wait and queue age. Introduce row/job-specific locking and bounded item claims only when required. Preserve idempotency, owner fencing, evidence revisions, and cancellation. PostgreSQL can remain the queue store; a new message broker is not the first requirement.

### P2 — History storage/query paths grow without bounds

Evidence: [run schema and selection queries](../src/server/jobRunner.ts), [Drizzle schema](../src/db/schema.ts).

Every run copies the entire rule collection into its configuration and snapshots every job item, including skipped items. Results include full row/evidence data; QA is also repeated in several catalog/result representations. There is no retention/archive policy.

Beyond the active-run uniqueness index and primary keys, queue ordering and item selection lack tailored indexes for their status/position access patterns. Growing history makes repeated scans and full history responses increasingly expensive.

**Smallest fix:** choose a retention period, keep only needed rules per snapshot, and add indexes guided by `EXPLAIN` on production-like data. Preserve historical reproducibility when reducing duplicate payloads. Normalize job membership only if referential integrity/query requirements justify it.

### P2 — Accepted attribute edits do not change the QA template

Evidence: [catalog PUT](../src/server/catalog.ts) and [`prepareQaInput`](../src/lib/qaAgent.ts).

The edit API accepts `upload_attributes` and increments the revision, but QA builds `uploaded_template` from `raw_row` whenever an original row exists. Updating the parsed attribute object alone can leave QA checking the old value. This affects API callers; the normal UI currently edits source evidence rather than product attributes.

A pure-function check confirmed that a row with `raw_row.attributes__brand = 'Old'` and `upload_attributes.brand = 'New'` still sends `Old` to QA.

**Smallest fix:** define the canonical editable template. Either reject unsupported attribute edits, or update the template used by QA/exports consistently while retaining an explicit original snapshot. Do not silently accept an edit that the review ignores.

### P2 — Revisions fence workers, but not concurrent editors

Evidence: catalog PUT and the Dashboard SAP save flow.

The worker updates catalog results only when its captured revision matches. Human edits do not send an expected revision. Two people can read the same source object, save different changes, and have the later full object replace the earlier change. The worker safeguard does not solve this case.

**Smallest fix:** require the caller's expected revision for evidence writes and return 409 on a stale edit, or use truly independent field updates where appropriate. Add one two-editor conflict check before relying on concurrent editing.

### P2 — Schema changes and readiness are operationally weak

Evidence: [startup](../server.ts), [database setup/verification](../src/server/database.ts), [schema](../src/db/schema.ts), [configuration initialization](../src/db/qaConfiguration.ts).

Startup performs DDL in multiple initialization routines. There is no versioned migration ledger/release command. The raw SQL and Drizzle definitions duplicate schema intent, and startup requires elevated schema privileges. Large tables or conflicting old data can prevent a release from becoming ready.

`verifySchema` performs 16 database queries for each health/status call. The frontend checks status every 15 seconds, and Compose probes every 30 seconds. Readiness checks schema access, not worker progress or provider usability. A stalled worker can coexist with a healthy endpoint.

**Smallest fix:** version/rehearse migrations, eventually separating migration permissions from the runtime account. Verify full schema at startup; use a cheap connectivity probe and a worker-progress signal for ongoing checks. Add structured request/error metadata and queue/worker alerts without logging credentials or evidence.

### P2 — Type safety and maintainability need small, focused improvements

Evidence: [compiler options](../tsconfig.json), API/state types, and UI modules.

Strict mode is disabled; important boundaries use `any` and `Record<string, any>`. The optional strict check produced 11 diagnostics, including nullability, optional-value handling, missing React DOM declarations, and dynamic indexing. Passing the current compiler is useful but provides weaker guarantees than the file extensions suggest.

Dashboard is 1,085 lines, Jobs 640, and Users 598. These modules combine UI, data workflows, imports/exports, and error handling. Shared AppContext makes broad state updates rerender consumers. Error/request handling is partly centralized in `api.ts`, while other paths still use raw fetch and handle session expiry inconsistently.

**Smallest fix:** clear the 11 diagnostics and enable strict checking; type the QA/run/result contracts at trust boundaries. Extract existing import/export logic from large screens when changing it, rather than creating a generic service/repository framework. Reuse `api.ts` for normal protected requests. Some compatibility code should stay until legacy-data migration is complete.

### P3 — Summary reporting and accessibility have visible gaps

Evidence: Dashboard summary export and table/modal markup; Users dialogs.

Summary counters check `missing`/`mapping`, while validated QA issues use other names, so counts can be wrong. There are multiple partly unused export helpers. Several selection controls are clickable table cells/containers, and custom dialogs lack complete keyboard/focus/dialog semantics. Some icon controls lack accessible names. The large fixed navigation/table layout also warrants small-screen checks.

**Smallest fix:** correct the counters or remove unsupported ones; consolidate exports around the existing worksheet helper when requirements match. Use real buttons/checkboxes, named controls, and accessible dialog focus behavior. Verify keyboard operation. These basics should not be deferred as speculative polish.

## Architectural strengths worth preserving

- **Appropriate deployment unit:** one Express app serving its own React frontend avoids unnecessary service boundaries and cross-origin setup.
- **Durable execution:** jobs, item snapshots, attempts, actors, and results survive tab closure/restart.
- **Ownership protection:** database worker ownership and tokens fence saves after loss/cancellation.
- **Revision protection:** late worker output cannot overwrite edited evidence.
- **Safe retry distinctions:** transaction retries cover known aborted conflicts; ambiguous commit failures do not automatically repeat model calls.
- **Bounded upstream work:** deadlines, cancellation, response-size limits, transient retry budgets, and provider admission exist.
- **Server identity/secrets:** hashed passwords/tokens, HttpOnly cookies, origin checks, role enforcement, sanitized provider errors, and write-only scraper keys are real safeguards.
- **Persistence discipline:** atomic catalog imports, uniqueness constraints, rollback, and visible save failures are preferable to optimistic success without storage.
- **Meaningful fast tests:** tests cover failure/cancellation/retry contracts rather than only happy-path rendering.
- **Usable packaging:** lockfile, multi-stage Dockerfile, non-root execution, private host binding, resource caps, log rotation, and shutdown hooks are present.

There is no reason to replace PostgreSQL, add a microservice per module, adopt a state-management framework, or introduce Kubernetes solely because this audit found limits.

## Will it break when the app scales?

**It will hit predictable capacity and availability ceilings.** Data size, simultaneous viewers, write volume, and review arrival rate matter separately. There is no honest supported user/SKU limit without workload measurements.

| Scenario | What happens first | Likely failure mode |
| --- | --- | --- |
| Larger catalogs | Full evidence payloads, browser parsing/rendering, repeated filtering | Slow UI, large transfers, memory exhaustion |
| More Jobs viewers | Per-job history fetches and full-data refresh | Database pool wait, latency, 503s, excess bandwidth |
| More queued QA | Serial service rate stays fixed | Backlog; large jobs delay small jobs |
| Larger imports | Sequential writes hold mutation lock longer | Edits/run claims/cancellation updates wait |
| More API replicas | Only one worker wins; process-local limits multiply | More DB/provider pressure without proportional QA speedup |
| Transaction-pooled DB connection | Worker session ownership assumptions no longer hold | Correctness/availability risk, not just slower performance |
| Longer history | Bigger snapshots and unbounded history scans | Storage growth and progressively slower progress/history queries |
| Many legitimate logins | Shared successful-attempt cap exhausted | Valid users denied with 429 |

### Two illustrative calculations

**QA throughput:** with one serial worker and mean service time `T` seconds, the optimistic ceiling is roughly `3600 / T` SKUs/hour, before overhead. At 30 seconds/SKU, that is 120/hour and 1,000 items take about 8.3 hours. At 60 seconds/SKU, it is 60/hour and about 16.7 hours. These are assumptions, not measured provider times. Sustained arrivals above capacity make the queue grow indefinitely.

**Idle Jobs polling:** with `U` viewers and `J` jobs, each two-second cycle issues approximately `J + 2` requests before active-run/detail/status extras. Twenty viewers with 100 jobs imply roughly `20 × 102 / 2 = 1,020` requests/second. Each authenticated request also looks up its session, and the catalog response repeatedly transfers all evidence. The busy flag avoids overlapping cycles within one screen; it does not remove this amplification across viewers.

Do not interpret the 10,000-row import limit as a tested 10,000-row deployment capacity. Average evidence size and history count can dominate row count. The database pool is fixed at 10 connections per process, with 15-second acquisition/query/statement limits; replicas multiply connections, while a worker holds one dedicated connection during execution.

PostgreSQL documents that [session advisory locks last for the database session](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS). PgBouncer's [pooling feature matrix](https://www.pgbouncer.org/features.html) distinguishes session-lock support from transaction pooling. The current worker therefore needs direct/session-mode connectivity.

## Deployment readiness decision

**Do not approve a broad production release of this exact version.** The app has not been deployed; resolve the remaining findings and verify a future installation before release.

| Present | Missing or unresolved |
| --- | --- |
| Production build/start path and fixed QA import/result boundary | Target-host verification of the QA fix and legacy rerun workflow |
| Dockerfile and Compose | Safe required bootstrap credentials |
| Non-root process and private port | Dependency remediation and reachability review |
| Session/role/origin controls and passing disposable DB/browser suites | Release checks against the actual HTTPS installation |
| Durable runs and retry budgets | Live provider contract verification for the saved model |
| Readiness and rotating logs | Worker/queue monitoring and production load measurements |
| Shutdown hooks and historical runbooks | Versioned migration/release gates and checked-in CI |
| Historical backup/rollback records | Current target-host backup restoration and release smoke test |

Minimum release evidence should include the following after remediation:

1. A regression proving client-supplied QA cannot become trusted review state.
2. Explicit unique administrator provisioning and rotation of any default-created account.
3. Reviewed dependency updates with fast/import/export checks still passing.
4. The existing PostgreSQL security/configuration suites on a disposable database, including upgrade rehearsal against a restored production-like schema.
5. The browser suite with Chromium libraries installed, plus real HTTPS auth/role/evidence/export checks against the release.
6. Docker or native-service smoke testing matching the actual target, including origin, database TLS/connection mode, private binding, and restart recovery.
7. A deliberately authorized live sample for QA and, if required, ScrapeGraph, checking the actual model/key/quota and saved output. Connectivity alone does not prove review correctness.
8. A verified backup, known deployed commit, compatible rollback release, and an operator able to detect a stuck worker.

For public access, also resolve ingress body/concurrency admission and the shared login-denial behavior. For multi-organization use, add authenticated tenant ownership to every relevant data query before accepting separate customers.

## Recommended order of work

**Before the next broad release:** deploy and smoke-test the completed QA trust fix, require bootstrap credentials, patch the importer/dependency chain, fix login admission, and scope request-body limits. Use small regressions at the shared boundaries. Complete the remaining release checks; do not create a new test framework.

**Before catalog/viewer growth:** paginate summaries, fetch details on demand, replace per-job polling with a compact progress query, bulk/bound writes, add measured indexes and retention, and monitor queue age/worker progress.

**Before adding workers/replicas:** measure whether provider latency or DB contention is dominant. Add bounded parallel claims and appropriate locks, then shared provider/scraper/auth admission and a connection budget. Keep the database queue until it measurably fails requirements.

**While maintaining the app:** enable strict TypeScript, make template/result ownership explicit, consolidate duplicate export/request paths, and fix keyboard/dialog accessibility. Extract responsibilities when touching large components; avoid a wholesale rewrite.

## Documentation changes made

[README.md](../README.md) was rebuilt around actual source behavior: beginner setup, explicit credentials, workflow, spreadsheet schema, rules, personal scraping, run recovery, status semantics, historical exports, roles, storage, API, command/test prerequisites, deployment/rollback, scaling limits, and troubleshooting.

Old live-host assumptions are identified as historical and linked to the appropriate runbook. The README no longer recommends the known password, calls `npm test` a fast suite rather than a complete suite, or says durable jobs lack historical result snapshots. Application code and credentials were not changed, so all unresolved findings remain open.
