# Codebase analysis

Reviewed on **2026-09-16**, against application commit `66d3ce35b9b33e6311fbfd3c5e4e69d6f512699e`, before this documentation change. Source references below use that snapshot's line numbers. This is a source and local-check review, not a live production penetration test or a database inspection.

The product has a useful, relatively direct architecture: a React client, one Express process, PostgreSQL persistence, a browser scraper, and an LLM proxy. The main problems are incomplete persistence/error handling, browser-owned job execution, and a browser-local login that does not secure the API. Cleanup is worthwhile, especially the tracked dependencies and obsolete scripts, but those correctness problems should not be disguised as dead-code removal.

[README](../README.md) documents current behavior and operating procedures. [Codex task briefs](codex-tasks.md) separate behavior-preserving cleanup from the improvements roadmap. No application code, schema, deployment, or Git history was changed during this documentation pass.

## Review coverage and evidence

The review traced application entrypoints, component event handlers, hooks/context, every API route group, schema initialization, QA input/output processing, scraper helpers, export helpers, build/container configuration, and existing test entrypoints. Root rewrite scripts were inspected as deletion candidates, not executed. Third-party source was consulted only where needed to establish runtime/peer dependency use. Database dump contents, environment secrets, and the live host were not inspected.

| Measurement | Observed value | Meaning |
| --- | --- | --- |
| Tracked files | 23,736 | Includes dependency files, not just authored source |
| Tracked `node_modules` | 23,655 files; 384,881,448 bytes (384.9 MB) | Present in Git despite an ignore entry |
| Tracked `dist` | 6 files; 1,515,908 bytes | Includes old `dist/server/server.js` and `migrate.js`, unlike the current `dist/server.mjs` build entrypoint |
| Tracked database backup | 342,478 bytes | An operational artifact exists in `backups`; contents not reviewed |
| Tracked `src` files | 44 | Application and test files |
| Main source sizes | Server 720 lines; Dashboard 1,108; Jobs 897; context 338 | Concentrated responsibilities; size alone is not a reason to add abstractions |
| Obsolete script candidates | 9 `.cjs` files plus one patch, totaling 1,237 lines | No references from application source; inspect tooling references before removal |
| Fresh frontend build | JS 1,806.25 kB / gzip 539.62 kB; CSS 73.78 kB / gzip 12.43 kB | Vite emitted a large-chunk warning |
| Dependency audit | 8 affected dependency entries: 1 high, 7 moderate | Includes transitive chains; not eight independent exploitable application bugs |

File sizes are filesystem byte totals of tracked files, not Git pack size or projected historical repository shrinkage. Untracking files will not remove their earlier versions from Git history.

## Architecture and end-to-end behavior

### Browser and component lifecycle

[App](../src/App.tsx#L20) chooses modules with component state rather than a router. Switching modules unmounts the previous module. [AppContext](../src/context/AppContext.tsx#L77) owns the catalog, saved job list, local user accounts/session, and notifications. Catalog and jobs load when the provider mounts, including before the login screen is dismissed; there is no server authentication gate around those reads.

The UI has six reachable modules: Dashboard, Scraper, Attribute Sets, Jobs, LLM Settings, and Users. The Users module is hidden/checked using a browser-local role. The server never receives or validates that role. Shared PostgreSQL access is through Express/Drizzle, not a browser Supabase SDK or per-user database identity.

### 1. Upload and catalog persistence

[Dashboard import](../src/components/DashboardModule.tsx#L328) uses SheetJS in the browser, reads the first worksheet, retains header order, and builds `SkuData` records. `sku`/`SKU` is required; the first duplicate in a file wins, and existing catalog SKUs are skipped by the UI. `attributes__` fields, SAP/URL aliases, and attribute-set names are recognized; other original cells remain in `raw_row`.

[useCatalogData](../src/hooks/useCatalogData.ts#L53) updates local state and posts the array. [The server](../server.ts#L162) upserts one row at a time by SKU. This is not an atomic batch. POST deliberately retains several prior values through `COALESCE`, whereas PUT changes explicitly supplied fields. The UI's duplicate-skip policy is therefore different from the API's upsert capability.

Raw upload values and current editable source evidence are separate: SAP edits update `source.sap`, not the original `raw_row`. This is tested behavior and must survive cleanup. It also means exported original source columns can differ from evidence used in a later QA run.

### 2. Evidence collection

Dashboard, Jobs, and Scraper call `/api/scrape`. [The endpoint](../server.ts#L478) normalizes a missing URL scheme, loads matching database selectors, launches a new CloakBrowser per request, and closes it in `finally`. It waits for DOM content, optionally waits for network idle, detects selected blocked responses, scrolls Amazon pages, and optionally captures configured specification tabs.

[Dynamic tab capture](../src/lib/captureDynamicTabs.ts#L36) supports one shared panel or paired panels, bounds tab count and waits, detects navigation away, and embeds partial-failure warnings. Cheerio removes common navigation/advertising elements; configured CSS selectors narrow the content; Turndown converts it to Markdown. [Blocked-page detection](../src/lib/blockedScrapePage.ts#L11) handles specified HTTP statuses and two Amazon challenge patterns, not every failed/non-product page.

Selector matching is performed on the server. The older browser `matchUrlRule` helper is returned by a hook but has no application consumer. Manual Markdown input and SAP editing remain active features.

### 3. QA scheduling and configuration

[JobsModule](../src/components/JobsModule.tsx#L57) runs selected jobs sequentially. Within one job, browser workers process SKUs concurrently, defaulting to two. Run state, the stop flag, and worker promises belong to that component; PostgreSQL stores records, not executable queue ownership.

At run start, [fetchQaConfiguration](../src/lib/qaConfiguration.ts#L8) obtains shared memory and category rules. [The server](../src/db/qaConfiguration.ts#L83) reads them in a repeatable-read transaction and uses `Cache-Control: no-store`. Failure blocks the run. [prepareQaInput](../src/lib/qaAgent.ts#L104) requires usable SAP/web evidence, selects normalized category rules, retains relevant original template columns, limits web text, and adds warnings for unavailable rules or truncated evidence.

Memory/rules and prepared evidence remain stable across a SKU's retries. Existing QA output and source metadata are excluded from template fields. Prompt text treats product content as untrusted data and preserves SAP precedence; these are instructions to the model, not independent factual verification.

### 4. Model call and result persistence

[/api/chat](../server.ts#L604) takes a client-supplied base URL, key, and payload and forwards them to chat completions. It retries up to three times and may retry without `response_format` after provider errors. Jobs adds its own retries, defaulting to three after the initial attempt, so repeated failures can produce up to 12 upstream attempts for a SKU.

[llmResponse](../src/lib/llmResponse.ts) extracts common response shapes and attempts limited JSON repair. [finalizeQaResult](../src/lib/qaAgent.ts#L149) validates structure/enums, checks claimed source use, requires explanations and supported mismatch fields, and reconciles colors/counts/status. This is a strong existing boundary worth preserving, but it cannot prove that a suggested fact appears in the evidence.

Results are stored in `qa_result`, copied into `raw_row.qa_result`, and also projected into `export_data`. The job references SKU identifiers; it does not own an immutable per-run copy. A processing-completed job can contain products with a fail verdict. `hasCompletedQa` distinguishes those reviewed failures from processing errors.

### 5. Excel output

[Jobs exports](../src/components/JobsModule.tsx#L352) check category/header compatibility, deduplicate SKU identifiers, and optionally filter to warning/fail verdicts. [populateQaWorksheet](../src/lib/qaExcelExport.ts#L19) groups issues against original headers and adds only needed correction columns. It preserves original cells, chooses highest-severity highlighting, writes classic cell notes, and leaves conflicting/unknown replacements blank.

The active [Dashboard summary export](../src/components/DashboardModule.tsx#L472) is a different layout. Two older Dashboard download functions are unreachable. Tests cover Excel serialization and correction behavior; neither Excel library can be removed solely because the other exists: SheetJS currently imports `.xls`/CSV/XLSX, while ExcelJS produces annotated output.

### Storage and startup

[Schema](../src/db/schema.ts) defines catalog, jobs, category rules, memory, selectors, and an unused-by-login users table. [Database setup](../src/db/index.ts#L9) validates the connection URL and creates a pool with ten connections and a 15-second connect timeout.

[Startup DDL](../server.ts#L52) is partial and best-effort. Shared configuration has transactional initialization and non-overwriting seeding; other alterations are attempted individually and failures are logged. `sku_data` and its enum types are not created by this path. `/api/db-status` checks only `SELECT 1`.

Provider settings/API keys, local credentials/session, last filename, and selector cache are browser-local. Notifications and active run controls are memory-only. Some legacy configuration caches intentionally remain for migration. These are different persistence contracts, not interchangeable stores to delete wholesale.

## Findings and recommended changes

Priority: **P1** means access control, data integrity, or deployment reliability work to address before expanding use; **P2** is the next maintenance/reliability pass; **P3** is conditional work after measurement or a confirmed product requirement. “Confirmed” means supported by source or local checks. Runtime scenarios below are acceptance tests, not claims that production incidents were reproduced.

### F01 — P1: Browser login does not authenticate API requests

**Evidence — confirmed:** [AppContext](../src/context/AppContext.tsx#L62), [LoginScreen](../src/components/LoginScreen.tsx#L5), and [server middleware](../server.ts#L18). Default credentials are embedded/prepopulated, passwords and roles are stored in localStorage, and routes have no authentication or authorization middleware. Credential values are deliberately omitted here.

**Consequence:** direct access to Express bypasses the login and admin UI. The documented Caddy gateway can restrict access, but its live configuration is unverified; it does not enforce application roles. Browser API keys are also plaintext localStorage data.

**Smallest fix:** keep the gateway and loopback binding as immediate deployment requirements and verify them. For the already-present multi-user/admin feature, enforce server sessions, password hashing, and role checks using the existing database; remove shipped credentials and migrate away from local passwords. Treat any reused embedded credential as exposed. Avoid adding an identity service unless needed.

**Verify:** unauthenticated reads/writes fail, a regular user cannot call admin operations directly, logout invalidates access, no credential values appear in built assets, and all gateway page/asset/API paths require authentication. Include appropriate session/CSRF protection when introducing cookie-based writes.

### F02 — P1: Unrestricted outbound destinations and permissive API exposure

**Evidence — confirmed:** [scrape input](../server.ts#L478), [chat proxy](../server.ts#L604), and `app.use(cors())` at [server.ts](../server.ts#L22). URL syntax is not a private-network restriction; chat accepts a caller-chosen endpoint. Browser navigation, redirects, and subrequests are not network-restricted.

**Consequence:** an API caller can ask the server to contact destinations reachable from the server/container, including internal services. Exact reachability was not tested. The 50 MB parsers and unrestricted requests also make resource abuse easier.

**Smallest fix:** validate HTTP(S) URLs and restrict outbound network access at the server/network boundary, covering DNS resolution, IPv4/IPv6, redirects, and browser subresources. Configure explicit trusted exceptions for required private LLM providers; product scraping should target public destinations. Restrict CORS to intended origins or remove it for same-origin use. Apply measured body/rate/work limits.

**Verify:** local/private/link-local destinations and redirects are rejected; permitted product pages work; only configured private LLM endpoints remain reachable. Cross-origin and oversized requests follow the documented policy. Use controlled fixtures, not probes of live internal systems.

### F03 — P1: Optimistic writes ignore failed HTTP responses

**Evidence — confirmed:** [catalog mutations](../src/hooks/useCatalogData.ts#L53), [job mutations](../src/context/AppContext.tsx#L248), and [selector deletion](../src/hooks/useSiteSelectors.ts#L108) update state before persistence and often never check `response.ok`. `fetch` does not reject merely because the server returned 4xx/5xx.

**Consequence:** imports, job creation, deletes, and clears can appear successful and then revert on reload. Catalog and job clearing happen through separate requests, so one may succeed while the other fails.

**Smallest fix:** return/await success from the existing mutation functions, commit UI state only after confirmed writes (or explicitly roll back), and show actionable errors. Give the server a transactional clear operation if the UI promises to clear both datasets together. Reuse the confirmed-save pattern in `updateSku` and the SAP editor.

**Verify:** inject HTTP 400/503, disconnection, and a failure between catalog/job clears. No false success notification; data remains consistent; retry works without losing the user's draft.

### F04 — P1: Job processing ignores the result of confirmed-save helpers

**Evidence — confirmed:** [useCatalogData.updateSku](../src/hooks/useCatalogData.ts#L98) returns a boolean, but [JobsModule](../src/components/JobsModule.tsx#L143) ignores it for running state, evidence, and results. It marks a SKU processed and counts tokens after a failed result save. [Dashboard source controls](../src/components/DashboardModule.tsx#L1024) also advance or notify without awaiting persistence; the SAP editor is the useful exception.

**Consequence:** a paid model response or manually supplied evidence can be lost while the UI reports completion.

**Smallest fix:** check every caller of `updateSku`, distinguish saving from processing, retain successful model output while retrying its save, and stop/flag the job when persistence fails. Do not repeat an LLM request merely to retry a database write.

**Verify:** a valid model response followed by a failed save does not count as completed; retry persists the same result with no extra model call. Manual content remains editable until saved, and source/result failures survive UI navigation visibly.

### F05 — P1: Job ownership and interruption recovery are missing

**Evidence — confirmed design; concurrency scenarios need runtime reproduction:** [module switching](../src/App.tsx#L110), [local run state](../src/components/JobsModule.tsx#L46), and [worker loop](../src/components/JobsModule.tsx#L123). The stop flag is local, active requests have no client abort signal, and no server-side claim prevents two clients running the same job.

**Consequence:** closing the page stops orchestration; switching modules can leave promises running with lost controls; multiple clients can duplicate provider calls or overwrite SKU results. Saved `running` records have no automatic recovery owner.

**Smallest fix:** first keep execution ownership in stable app-level state, preserve stop/progress controls, add failure-safe finalization, and reconcile interrupted runs. Enforce a database-backed claim if concurrent clients can execute the same job. Move execution to a small server worker using PostgreSQL only when jobs must survive browser closure; a new queue service is not the starting point.

**Verify:** switch modules, reload, stop during scrape/model/save, and start the same job from two clients. There is one owner, no hidden duplicate work, and every interrupted SKU has an actionable resumable state.

### F06 — P1: Incomplete schema initialization can coexist with a green health check

**Evidence — confirmed:** [startup](../server.ts#L52) alters but never creates base `sku_data`; [health](../server.ts#L27) runs `SELECT 1`. [Drizzle config](../drizzle.config.ts) names a migration output directory, but no versioned migrations are checked in. Startup also changes a column type and drops named constraints.

**Consequence:** a fresh database can report connected while catalog requests fail. Existing database changes are not represented by an auditable ordered upgrade path, and the runtime DB account needs DDL privileges.

**Smallest fix:** document fresh initialization now, then use the existing Drizzle tooling for reviewed versioned migrations with a baseline compatible with existing deployments. Separate migration execution from serving traffic, and report schema/config readiness separately from connectivity.

**Verify:** initialize an empty test database, upgrade a representative legacy schema, restart twice, preserve data/rules/deletions, and surface migration failure as not-ready. Test backup/restore in isolation before production changes.

### F07 — P1: API shape checks, atomicity, and not-found handling are inconsistent

**Evidence — confirmed:** [catalog POST/PUT](../server.ts#L162), [jobs POST/PUT](../server.ts#L284), and [schema JSON fields](../src/db/schema.ts#L29). Catalog POST assumes an array; several routes accept unchecked statuses/JSON shapes and return database messages. Catalog/job updates can return success for nonexistent IDs. Batch inserts lack a transaction. Settings normalize some numeric values but not concurrency/retry bounds.

**Consequence:** malformed requests reach the database, partial imports are possible, and callers cannot reliably distinguish “saved” from “nothing matched.” TypeScript `any` does not validate request bodies.

**Smallest fix:** validate actual request shapes and numeric bounds at the boundary with small shared functions where reused; return consistent 400/404/409 errors; transactionally apply promised batches; reuse database error redaction rather than leaking raw error messages. Keep endpoint compatibility where possible and document intentional changes.

**Verify:** null/wrong-shaped payloads, invalid enums, fractional/negative/huge settings, unknown IDs, duplicates, and a middle-of-batch failure produce defined responses and no partial data loss.

### F08 — P1: Retry and resource limits do not bound total request work

**Evidence — confirmed:** [chat retry loop](../server.ts#L615), [client retries](../src/components/JobsModule.tsx#L198), and [scraper launch](../server.ts#L512). The proxy retries most 4xx other than 401/402/403, not only transient errors. Its 90-second timer is cleared when headers arrive, before reading the response body. Each scrape launches a browser without a process-wide concurrency limit.

**Consequence:** permanent request errors can be repeated; stalled bodies have no application-enforced body timeout; multiple users can exceed the Compose memory budget despite each browser's SKU concurrency setting. Stop does not cancel in-flight upstream work.

**Smallest fix:** give retries one explicit total budget, retry only transient cases (with targeted format fallback), honor provider retry hints, and keep deadlines through body consumption. Add bounded admission for browser work and cancellation/disconnect cleanup. Measure before introducing a browser pool.

**Verify:** slow headers/body, repeated 400/429/503, format rejection, and client disconnect have bounded attempts/duration. Concurrent scraping stays within an observed memory limit and closes every browser on errors.

### F09 — P1: Known dependency advisories need triage, especially spreadsheet input

**Evidence — confirmed audit, exploitability not tested:** `npm audit --package-lock-only --ignore-scripts --json` reports one high and seven moderate affected entries. The lockfile installs `xlsx` 0.18.5, ExcelJS 4.4.0, and drizzle-kit 0.31.10.

| Affected entries | Audit severity | Advisory / path |
| --- | --- | --- |
| `xlsx` | High | [Prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), [regular-expression denial of service](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9); actively parses uploaded files |
| `qs` | Moderate | [Array-limit bypass](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [isBuffer denial of service](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g); request parser dependency |
| `uuid`, `exceljs` | Moderate | [Buffer bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq); inspect actual vulnerable-call reachability |
| `esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` | Moderate | [Development server advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99); nested tooling dependency, not proof the production bundle exposes that server |

**Consequence:** untrusted spreadsheet parsing deserves prompt attention; transitive findings need context rather than an automatic downgrade. Audit suggested older major versions of ExcelJS/drizzle-kit and no automatic `xlsx` fix.

**Smallest fix:** triage by runtime exposure, use a maintained patched spreadsheet distribution or a format-compatible alternative, and update affected transitive dependencies through supported versions. Preserve `.xls`, CSV, header handling, comments, and correction exports. Do not run `npm audit fix --force` indiscriminately.

**Verify:** rerun audit and record residual exposure/mitigation; test malformed/oversized uploads and round-trip supported formats. Test schema tooling and annotated exports after any dependency change.

### F10 — P1 for backup handling; P2 for repository hygiene: Generated and operational artifacts are tracked

**Evidence — confirmed:** Git tracks the measured `node_modules`, six `dist` files, and `backups/pre-start-migration-20260811.dump`. [.gitignore](../.gitignore) ignores dependencies but does not untrack existing files or cover builds/backups. [.dockerignore](../.dockerignore) does exclude them from image context.

**Consequence:** clones/diffs contain machine-specific dependencies and stale builds. The backup may contain operational data; its contents and repository visibility were not assessed. Ignore rules do not protect already-tracked files or history.

**Smallest fix:** securely retain and verify the backup outside the repository before untracking it. Untrack generated dependencies/builds, extend ignore rules, and use the npm lockfile to reproduce them. Review exposure separately if needed; do not rewrite Git history as part of routine cleanup.

**Verify:** fresh-clone install/build passes; generated/cache/backup files no longer appear in the tracked set; the retained backup checksum matches. Historical size/data are not claimed to have been removed.

### F11 — P2: Verified dead code and one-off rewrite scripts remain

**Evidence — confirmed for unused locals; reference audit required for whole-file/dependency deletion:** the unused-code TypeScript check reports 40 diagnostics. Candidates are listed below and in Task 1. `exportQAExcel`/`downloadJSON` are not wired to UI; `updateSkuStatus` and `matchUrlRule` have no application callers.

**Consequence:** stale alternative implementations obscure the actual workflow. Executing old rewrite scripts can overwrite newer code. Extra dependencies expand installation and maintenance cost.

**Smallest fix:** remove proven-unused functions/imports/state and obsolete scripts; remove unused direct dependencies and their lockfile entries. Do not delete error reporting intent, reachable features, schema fields, or migration compatibility just because a simplistic reference scan flags them.

**Verify:** traced entrypoints, focused checks, active workflow smoke checks, clean install/build, and a deletion manifest. Preserve Express error middleware's four-argument arity while cleaning unused parameters.

### F12 — P2: Current evidence and historical review semantics need explicit handling

**Evidence — confirmed storage design:** [SAP save](../src/components/DashboardModule.tsx#L59) intentionally preserves the original upload and prior result; [QA writes](../src/components/JobsModule.tsx#L225) duplicate results; [exports](../src/components/JobsModule.tsx#L370) read current catalog rows for any job. Schema also retains both attribute-set name/legacy ID fields.

**Consequence:** editing evidence can leave a result that looks current but was produced from older evidence. Rerunning a SKU can change the output exported from an older job. Redundant representations can diverge, but legacy readers still depend on them.

**Smallest fix:** visibly mark results needing rerun after source/rule changes while preserving original cells and existing saved results. Establish one canonical read contract and test old records before any phased storage cleanup. Add immutable per-run history only if audit/history requirements demand it.

**Verify:** source edits preserve original values, visibly distinguish stale results, and reruns clear that state; exports and older stored records remain readable. If snapshots are later required, earlier job exports remain stable after subsequent runs.

### F13 — P2: Upload failures are computed but never shown

**Evidence — confirmed:** [Dashboard error state](../src/components/DashboardModule.tsx#L17) is written for empty/invalid/no-SKU files in [handleFileUpload](../src/components/DashboardModule.tsx#L328) but not rendered. The skipped-missing-SKU counter is not surfaced.

**Consequence:** an invalid upload can appear to do nothing. This is a broken error-reporting path, not a reason to remove validation or failure messages.

**Smallest fix:** render an accessible error and import summary beside the upload control; preserve the prior catalog and explain missing/duplicate rows. Clear the message on a new attempt or success.

**Verify:** empty file, corrupt file, missing SKU header, unreadable file, and duplicate/missing rows produce visible feedback without claiming persistence before it succeeds.

### F14 — P2: Dashboard summary uses obsolete issue types

**Evidence — confirmed:** [exportToExcel](../src/components/DashboardModule.tsx#L472) counts `issue_type === 'missing'` and `'mapping'`, while [the QA contract](../src/lib/qaAgent.ts#L69) emits `missing_data`, `data_mismatch`, `formatting`, `spelling_grammar`, and `unsupported_claim`.

**Consequence:** summary columns can show zero despite relevant findings, reducing confidence in exports. This active export is not the dead `exportQAExcel` function.

**Smallest fix:** count `missing_data` and replace the misleading “Mapping Errors” column with an explicitly named supported metric such as “Data Mismatch Count.” Prefer canonical `qa_result` with the existing legacy fallback. Keep the detailed Jobs export intact.

**Verify:** a workbook containing each supported issue type has matching summary counts and unchanged original/detail export behavior.

### F15 — P2: Category and selector uniqueness rules differ by path

**Evidence — confirmed:** [getCommonAttributeSet](../src/lib/jobRunState.ts#L38) compares raw category strings; [prepareQaInput](../src/lib/qaAgent.ts#L109) normalizes them. [Selector create/update](../server.ts#L417) scans for duplicate domains in application code; [schema](../src/db/schema.ts#L64) has no domain unique constraint.

**Consequence:** visually equivalent category names can block grouping/export. Concurrent selector writes can create duplicates with ambiguous rule choice; that race has not been reproduced.

**Smallest fix:** reuse trim/case normalization for category comparisons while preserving display/original values. Enforce normalized selector-domain uniqueness in PostgreSQL after checking existing data, and return 409 for conflicts. Do not automatically discard different existing selector rules.

**Verify:** case/spacing category variants group consistently, real category mismatches fail, and simultaneous normalized-domain creates yield one record and one conflict.

### F16 — P2: Configuration controls and caches can mislead users

**Evidence — confirmed paths; editor timing needs a browser check:** [selector loading](../src/hooks/useSiteSelectors.ts#L29) silently falls back to local cache; [settings](../src/hooks/useSettings.ts#L61) loads shared memory asynchronously; [settings editor](../src/components/LLMSettingsModule.tsx#L16) replaces the whole draft when settings change. Saving provider settings first saves shared memory. The [Provider Format dropdown](../src/components/LLMSettingsModule.tsx#L185) offers native-provider labels, but its stored `llmProvider` value is not consulted by Jobs or the chat proxy; every request uses chat completions.

**Consequence:** cached selector rules can look authoritative when the server could not load them. A late memory fetch can overwrite unsaved editor changes. Provider configuration cannot be saved while shared memory persistence fails. Selecting a provider label can imply unsupported native API compatibility.

**Smallest fix:** show stale/offline state and keep server rules authoritative; prevent asynchronous hydration from replacing a dirty draft. Make the existing combined-save dependency clear, or separate the two saves if independent provider editing is required. Label only the supported OpenAI-compatible transport; do not add native provider adapters without a requirement. Preserve legacy browser-rule/memory import features and existing compatible endpoint settings.

**Verify:** delayed/failed loads do not erase typed values or imply shared saves; imported legacy rules never overwrite existing nonblank rules; a failed save retains its draft; visible provider choices match the actual request protocol without losing saved keys/endpoints.

### F17 — P2: Spreadsheet edge cases and import limits need coverage

**Evidence — confirmed parsing choices; particular workbook corruption not reproduced:** [import](../src/components/DashboardModule.tsx#L338) uses formatted strings for header extraction but default value conversion for rows. `row.sku || row.SKU` skips numeric zero; duplicate headers, numeric identifiers, and very large input have no explicit policy/size guard. Requests allow 50 MB JSON and parsing happens on the UI thread.

**Consequence:** numeric identifiers can lose their intended representation, malformed headers can map unexpectedly, and large files can block the UI or fail after significant work.

**Smallest fix:** define/validate supported headers and identifier conversion, preserve text identifiers, and add file/row limits based on real catalog sizes. Report skipped rows precisely. Avoid workers/streaming until measured files require them.

**Verify:** leading-zero/text/numeric-zero identifiers, duplicate/blank headers, empty worksheets, `.xls`/CSV/XLSX, repeated SKUs, and oversized files have deterministic visible outcomes.

### F18 — P2 for bundle loading; P3 for scale: Heavy work is eagerly loaded and scans whole datasets

**Evidence — measured bundle and confirmed implementation:** [App imports](../src/App.tsx#L6), [Dashboard imports](../src/components/DashboardModule.tsx#L1), [Jobs imports](../src/components/JobsModule.tsx#L1), [catalog GET](../server.ts#L136), and [SKU lookup](../src/components/JobsModule.tsx#L99). ExcelJS/SheetJS and all modules enter the initial graph; the API returns the whole catalog including evidence/results; repeated `find` calls scan it.

**Consequence:** approximately 540 kB of gzipped application JS loads before spreadsheet use. Large catalogs additionally increase transfer, memory, and render/lookup cost; production-scale latency has not been measured.

**Smallest fix:** dynamically import spreadsheet libraries at their actions and compare bundle output. Use a `Map` for repeated SKU lookup where needed. Measure realistic catalog sizes before adding pagination, indexes, or virtualization; split large components only along responsibilities being changed.

**Verify:** import/export still work on first and repeated use; initial bundle gets smaller; record request size, memory, and response/render time on representative catalogs before claiming performance gains.

### F19 — P2: Several controls and dialogs lack native accessible behavior

**Evidence — confirmed markup; assistive-technology behavior untested:** [job selection](../src/components/JobsModule.tsx#L563) wraps a read-only checkbox in a clickable div without a label; [settings inputs](../src/components/LLMSettingsModule.tsx#L185) often have unassociated labels; [manual content modal](../src/components/DashboardModule.tsx#L990) uses divs without dialog semantics/focus management. The [SAP editor](../src/components/DashboardModule.tsx#L1047) already demonstrates a native dialog and associated labels.

**Consequence:** keyboard and screen-reader users may not identify or operate controls reliably; modal focus can escape. These are active UI features, not deletion candidates.

**Smallest fix:** use real checkbox change handlers/labels, label icon buttons and inputs, and reuse the native dialog pattern with focus restoration and Escape handling. Do not add a component framework for these fixes.

**Verify:** keyboard-only selection and modal opening/closing, accessible names, focus containment/restoration, and errors announced without relying on color.

### F20 — P1 for release safeguards; P2 for automation: Deployment and checks are manual

**Evidence — confirmed repository configuration; live automation unknown:** [package scripts](../package.json#L6), [Dockerfile](../Dockerfile), [Compose](../compose.yaml), and no checked-in `.github/workflows`. There is no aggregate test command. `npm start` does not set `NODE_ENV`; Docker does. Both npm and Bun lockfiles exist, while Docker/devcontainer commands use npm. Compose has no healthcheck or release identity.

**Consequence:** a push has no repository-defined deployment effect, a successful container start is not proof of schema readiness, and deployments cannot be reliably tied to the tested commit. A plain `npm start` outside Docker selects development middleware unless the environment is set.

**Smallest fix:** keep manual update/rollback instructions correct, standardize npm, add one command for the existing fast checks, and add CI using a clean install/build. Add a health/readiness check and observable commit identity. Then deploy the exact tested commit/image through GitHub Actions, with one deployment at a time, authenticated VPS access, health verification, retained previous image, and failure reporting. Keep the Funnel/Caddy topology unchanged.

**Verify:** failing checks block deployment; simultaneous pushes serialize; the running commit matches the tested commit; unhealthy release restores a compatible previous image; database migrations are backed up/reviewed separately. External gateway checks still require authentication, loopback bindings stay intact, and the unrelated port-443 service works.

## Cleanup inventory and things to retain

These are starting candidates, not permission to delete everything matching a filename pattern.

| Candidate | Evidence and boundary |
| --- | --- |
| `fix_app_context.cjs`, `fix_app_context2.cjs`, `fix_dashboard.cjs`, `fix_settings.cjs` | One-off source rewriting; no current package-script or runtime use found |
| `rewrite_dashboard.cjs`, `update_app_context.cjs`, `update_dashboard_ui.cjs`, `update_hook.cjs`, `update_server.cjs`, `update_server.patch` | Historical replacements/patches containing stale copies of live logic; 1,237 lines across all nine scripts and the patch |
| Dashboard `exportQAExcel`, `downloadJSON`, `manualScrapeText`, duplicate unused health state/effect | No callers/render use; preserve the active `exportToExcel`, manual-content textarea, and global health indicator |
| `useCatalogData.updateSkuStatus` and its context plumbing | Exposed but no consuming application code found |
| `useSiteSelectors.matchUrlRule` | Server performs live matching; no browser consumer found |
| `scraperTimeout` | Type/default only; current server uses fixed navigation timeouts |
| Unused imports, including Axios and `attributeSets` in server | Compiler evidence; assess module side effects and framework handler arity |
| Direct `@google/genai`, `motion`, `axios` | No active calls found; Axios has an unused import. Verify tools/config before uninstalling |
| `GEMINI_API_KEY`, Gemini capability metadata | No runtime integration; metadata may belong to an external host, so retain unless that consumer is ruled out |
| `bun.lock`, duplicate Vite placement, build/type packages in runtime dependencies | Standardize npm and classify build/runtime use; dependency movement is not the same as dead-code deletion |

**Retain:** `playwright-core` (CloakBrowser runtime peer), Tailwind typography (loaded by CSS), ExcelJS and SheetJS until a separate compatibility-tested change, the active Users/Login feature until an authentication replacement is ready, category Markdown reference documents, startup/schema compatibility, legacy QA/header fallbacks, and browser configuration import paths. Type packages can be used without explicit imports. Schema exports may be consumed by Drizzle introspection; lack of direct calls does not justify dropping tables or fields.

## Suggested execution order

1. Establish the actual gateway/production boundary and backup policy; address F01/F02/F09 exposure and F03/F04 data integrity.
2. Fix F05–F08 lifecycle, migrations, API contracts, and request budgets with focused regression checks.
3. Perform the independent behavior-preserving cleanup (F10/F11) without deleting compatibility needed by those fixes.
4. Address F12–F17 and F19 correctness/usability, then measure F18 improvements.
5. Put checks and release safeguards from F20 in place early; enable automatic deployment only after readiness, migration, and rollback behavior are trustworthy.

Do not start with a framework rewrite, generic repository layer, new state library, queue service, or a broad file-splitting exercise. Existing Express, Drizzle, React, Node APIs, and PostgreSQL cover most identified fixes.

## Validation record

These checks were performed during planning/analysis against the same unchanged application commit; application tests need not be repeated merely because Markdown changes.

| Check | Result and limit |
| --- | --- |
| `npm run lint` | Passed on Node 22.16.0 / npm 10.9.2; TypeScript only |
| `test:job-state`, `test:site-selector`, `test:blocked-page`, `test:db-error`, `test:lazy-content`, `test:llm-response`, `test:qa-agent` | All seven npm commands passed; the last runs settings and QA tests, for eight test files total |
| `npx --no-install tsc --noEmit --noUnusedLocals --noUnusedParameters` (local compiler) | Exited 2 with 40 unused-code diagnostics; intentionally stricter than the normal project check |
| Vite frontend build | Passed into a temporary directory; reported the bundle sizes above and large-chunk warning |
| esbuild ESM server build | Passed into a temporary directory using the package script's bundle options; an initial attempt mistakenly invoked the native binary through Node, then was corrected to execute the binary directly |
| Dependency audit | Exited 1: eight affected entries as listed in F09; no dependency fixes applied |
| `test:tab-capture`, `test:sap-editor` | Not run for this review; browser prerequisites were not verified. The SAP test can also update Vite caches tracked in this checkout |
| `test:qa-config-db` | Not run; no disposable test database was provisioned or modified |
| Clean `npm ci`, Docker build/runtime, production HTTP checks | Not run in this checkout; installation/builds could replace tracked artifacts, and production access was outside scope |
| Live VPS, Caddy/Funnel rules, deployed commit, shared database contents | Not inspected; previous deployment notes are documentation, not verified runtime state |

Build feasibility was checked with existing installed dependencies and temporary output, not a clean container installation. No provider requests or billable QA runs were made. Final documentation validation passed for 90 local links/anchors, npm script names, 14 Bash blocks checked with `bash -n`, Markdown fence balance, whitespace, all 20 findings' task coverage, omission of the embedded credential value, and the three-file change boundary. Tailscale listener syntax/exposure was checked against the official documentation linked from the README; no live listener was changed.
