# SKU-connected browser scraping

Dashboard, the Scraper screen, and durable jobs share one local browser worker. Successful retrieval is saved against the selected SKU before the request reports success or QA starts. Scraping uses no language model, provider credential, model gateway, or AI navigation.

| Library | Locked version | Purpose |
| --- | --- | --- |
| CloakBrowser | 0.5.12 | One isolated Chromium session with fingerprint defaults and humanized Playwright actions |
| Scrapling | 0.4.15 | Select content from captured rendered HTML; no fetcher extras or second page load |
| Markdownify | 1.2.2 | Convert the selected HTML locally, preserving links, headings, lists, tables, Unicode, and values |

`requirements.in` declares these direct dependencies; `requirements.txt` locks their transitive versions for Python 3.11. Browser Use and Crawl4AI are removed. There is no site-adapter service or extra crawler.

## Save evidence against a SKU

An authenticated client posts to `POST /api/catalog/:sku/scrape` with `{ "expectedRevision": 12 }`. The server uses that SKU's persisted `source.url`; clients cannot supply another URL or attachment target. The response is the saved catalog row, including `scraped_markdown`, `scrape_metadata`, `scrape_error`, and the new `revision`. The URL-only `/api/scrape` endpoint is removed.

Browser retrieval runs outside the write transaction. Saving checks the revision again: an edit, deletion, or competing scrape cannot silently replace newer evidence. Catalog edits also require `expectedRevision`; `409` asks the user to refresh while keeping their unsaved draft. Missing SKUs return `404`. Retrieval errors include `error` and `code`; a database save error never reports success.

Successful scraping records `method: "browser"`, requested and final URLs, and capture time, replaces Markdown, clears the latest scrape error, and increments the evidence revision. A failed attempt preserves previous Markdown and provenance; its separate `scrape_error` does not invalidate an otherwise usable review. Cancellation before commit preserves the old evidence. A completed commit survives a disconnected client.

Manual Markdown is recorded as `method: "manual"` and works without a URL. Existing Markdown is retained as legacy evidence without invented timestamps. Browser/legacy evidence remains viewable after a source URL change, but QA excludes it until it is replaced. `qa_revision` associates a review with the evidence it used; `qa_stale` hides older reviews and usage from current catalog exports while preserving immutable job history.

Dashboard bulk scraping runs selected SKUs sequentially with progress and cancellation. Scraper requires selection of an existing SKU and shows its URL, saved evidence, provenance, failures, and Markdown preview. Saving a URL edit happens before scraping that SKU.

Jobs accept URL-only SKUs and scrape their snapshotted URL when usable saved evidence is absent. Successful retrieval is committed to the run-item snapshot and, when its revision still matches, the catalog before calling QA. A later QA failure or cancellation does not lose collected evidence. Newer catalog edits are preserved; the historical run keeps the evidence it used. Retrieval failure can fall back to SAP. Without SAP or usable web evidence, the item fails explicitly. A fresh run may retry; restart recovery does not repeat an already-dispatched scrape for the same item.

## Install

Docker installs Python 3.11, Xvfb, fonts, Chromium libraries, the virtual environment, and the public CloakBrowser binary during build. Development containers install the worker in `postCreateCommand`.

On a native Debian 12 host, install system dependencies first:

```bash
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv xvfb xauth xfonts-base fonts-liberation \
  libglib2.0-0 libnss3 libatk-bridge2.0-0 libdbus-1-3 libcups2 libxcb1 libxkbcommon0 \
  libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2
PYTHON_EXECUTABLE=python3.11 npm run setup:scraper
```

Ubuntu releases can rename libraries or require a different Python installation. Run setup as the service user so its browser cache is accessible. Native services use the repository root as their working directory. `SCRAPER_PYTHON` overrides `.venv/bin/python` when needed.

The public browser binary is pinned to `146.0.7680.177.5`. Runtime downloads and automatic updates are disabled. Supplied binaries can override `CLOAKBROWSER_VERSION`, `CLOAKBROWSER_BINARY_PATH`, and optional `CLOAKBROWSER_LICENSE_KEY`; install them before starting the app. Docker supports `--build-arg CLOAKBROWSER_VERSION=…` for publicly available versions. Mount licensed binaries separately; never put credentials or license secrets in build arguments.

Headed Chromium under `xvfb-run -a` is the default. `SCRAPER_HEADLESS=true` is a fixture-test override. A supplied `DISPLAY` uses the existing X server. Setup launches a synthetic page and checks the retained stack without provider credentials or external retrieval. `npm run setup:scraper -- --check` repeats that runtime check without reinstalling packages.

Rebuild an existing development container to apply Dockerfile system packages if it lacks `xvfb-run` or Chromium shared libraries. Native hosts need the system packages above. Unset or repair an invalid `DISPLAY`; temporary test libraries do not establish deployment readiness.

## Collection and boundaries

The worker captures initial content and reveals recognizable disclosures, specification buttons, content tabs, dialogs, and lazy sections with bounded scrolling. Capture each revealed section before another interaction hides it; merge identical blocks without summarizing source text. Resolve relative links using the document's actual base URL. Ignore unrelated controls; unresolved potentially relevant panels or exhausted interaction budgets return `INCOMPLETE_CONTENT`.

Navigation stays on the original host/path, allowing `www` variants and HTTP-to-HTTPS redirects. Preserve submitted query values, including duplicates and blank values. Product, offer, and variant changes, forms, purchases, and downloads are blocked. Captures include the main document and visible dialogs; cross-origin iframe extraction is not supported.

A loopback egress proxy resolves and validates every DNS answer for every HTTP/HTTPS connection, then dials the chosen numeric public IP. Mixed public/private answers and unsafe redirects/subresources are rejected. Rechecking each connection prevents DNS rebinding. Host-resolution rules and proxy bypass settings prevent direct private-network connections. Service workers and WebSockets are blocked; non-GET/HEAD requests are blocked except recognized read-only GraphQL queries.

| Limit | Value |
| --- | --- |
| Browser queue | One active, eight waiting; 60-second queue wait |
| Execution | 120 seconds after admission, including startup |
| Interactions | 20 clicks / 20 explicit scroll steps |
| Output | 4 MiB protocol response; 200,000 Markdown characters including source URLs |

Cancellation and timeout terminate the worker group and remembered Chromium descendants, including Playwright's separate browser process group. PID start times avoid terminating a reused PID. Temporary profiles, browser/Xvfb processes, and proxy sockets are cleaned up; cleanup can take up to two seconds beyond the deadline.

Automatic challenges get a bounded ten-second wait. Remaining challenges, CAPTCHAs, and access denial return `PAGE_BLOCKED`. CloakBrowser addresses fingerprints and behavior; public-page coverage still depends on the site's access policy and IP reputation. Use SAP or manual Markdown when retrieval fails. Paid proxies, CAPTCHA services, and OCR are not included.

## Verify before rollout

```bash
npm test
npm run test:scrape-worker
npm run test:scrape-browser
npm run setup:browser
npm run test:sap-editor
TEST_DATABASE_URL=postgresql://… npm run test:security-db
TEST_DATABASE_URL=postgresql://… npm run test:qa-config-db
npm run build
TEST_DATABASE_URL=postgresql://… npm run test:scrape-production
```

Use a disposable database. The production smoke creates/drops an isolated schema and temporary administrator, checks preserved retired data and scrubbed navigation settings, overlaps SKU-bound public retrieval with mocked QA and login, verifies saved evidence after reloading, and rejects stale scrape/edit revisions. It spends no paid model credits. `SCRAPER_TEST_URL` changes the default `https://example.com/` target. Use `taskset -c <allowed-cpu>` for a native one-CPU measurement; process RSS excludes PostgreSQL and an external X server.

For the production container:

```bash
docker build -t paxth-qa:scrape-test .
TEST_DATABASE_URL=postgresql://… SCRAPER_TEST_IMAGE=paxth-qa:scrape-test npm run test:scrape-production
```

This uses host networking for the disposable database and limits the app to one CPU / 1,536 MiB / 256 MiB shared memory. Native checks do not establish container or target-VPS behavior.

Retain the previous release and a verified backup, rehearse startup on a restored database, finish/cancel active runs, then verify scrape → saved SKU evidence → QA → export. Reload browser clients because the old scrape contract is retired. Schema changes are additive and repeatable; existing retired credential columns, selector tables, source data, and job history remain untouched.

Verified on 7 October 2026: the built production server passed the disposable-database smoke with actual public-page retrieval, saved SKU evidence/revision conflicts, preserved retired data, scrubbed navigation configuration, SAP-only and URL-only mocked QA, login, and readiness. It completed the overlapping work in 21.4 seconds with peak descendant-process RSS of 934.4 MiB, excluding PostgreSQL and any external display server. This native run did not impose a one-CPU limit or execute Docker; container and target-host checks remain separate.
