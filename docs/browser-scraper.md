# Crawl4AI cloud product evidence

Development currently runs in GitHub Codespaces; the app has not been deployed. Deployment guidance below applies to future installations.

URL previews, saved SKU evidence, and durable QA/Catalog jobs share:

`public URL → Crawl4AI cloud API → GLM Markdown cleanup → product Markdown`

## Configure

Set server-only `CRAWL4AI_API_KEY` in `.env`. Keep `AICREDITS_API_KEY` for GLM/Q&A, or configure both `LLM_BASE_URL` and `LLM_API_KEY` for another model provider. Leave unused overrides commented as shown in [.env.example](../.env.example). Missing or incomplete credentials stop a scrape before cloud collection. The keys stay out of browser settings, model input, job snapshots, and public errors.

The cloud call follows the [official API reference](https://api.crawl4ai.com/llms.txt): native fetch to `https://api.crawl4ai.com/scrape`, Bearer authentication, JSON `{ "url": normalizedUrl, "format": "md" }`. There is one cloud request per scrape, with default proxy/region settings and no automatic cloud retries or local fallback. Full scraping consumes both providers' credits.

Restart the development server after changing environment variables and reload browser clients after updating the application. `GET /api/provider-settings` includes read-only `scraperConfigured` (cloud key present) and `providerConfigured` (model configuration complete). Presence does not establish key validity, balance, or network connectivity.

No Python, Xvfb, scraper browser cache, or proxy runtime is required. Docker production uses Node and native fetch. The development image retains Chromium libraries for UI tests; `npm run setup:browser` installs their browser.

## Cleanup and evidence

The independently configurable `scraperModelName` defaults to `z-ai/glm-5.3-flash`. Q&A retains `deepseek/deepseek-v4.1-flash` and its separate instructions. GLM receives the complete original cloud Markdown and source URLs, with fixed cleanup instructions, temperature `0.1`, and 16,384 output tokens. Cleanup sets `reasoning_effort: "low"` only for that exact GLM model; custom models and Q&A retain their existing parameters. GLM's [documented default effort is `max`](https://docs.z.ai/guides/capabilities/thinking); the 150,028-character Samsung capture failed three times with default effort and succeeded with low effort. Model retries reuse that Markdown and never recollect the page. The gateway can still return intermittent HTTP 500 responses with low effort.

The selected cleanup model now gets at most two attempts within a 60-second primary deadline. Retryable model/network errors or a stalled primary can switch to one backup attempt within the existing 120-second total cleanup deadline. GLM's backup is `deepseek/deepseek-v4.1-flash`; other selected models use GLM as backup. Authentication, configuration, credits, rate limits (including long retry delays), and invalid/refused/truncated output do not trigger a switch. Every attempt receives the same complete Markdown and cleanup instructions, without QA memory, and there is never another cloud collection. Successful preview diagnostics include `MODEL_FALLBACK` when used; evidence's `modelName` records the actual model. Saved model choices and Q&A retry budgets remain unchanged.

Cleanup removes advertisements, related products and their links, navigation, cookie banners, promotions/recommendations, rewards, financing/trade-in offers, optional add-ons/protection plans, duplicate boilerplate, JavaScript, and template placeholders. It preserves requested-product identity, identifiers, specifications, exact numbers, currencies, variants, tables, useful product/image/support/manual links, the product's own warranty, and source language. Prices must be clearly attributed to the requested product and its variant or seller; ambiguous, unrelated, or unrendered prices are omitted without repeating or explaining the omitted junk. Page instructions are untrusted content. The server appends the requested-source footer after cleanup; it includes a retrieved URL only when known. Empty, malformed, refused, unfinished, truncated, or oversized model responses fail the scrape with **Markdown cleanup failed** and preserve existing error codes and saved evidence. Instructions cannot guarantee factual preservation: inspect live raw/cleaned results.

New evidence records `method: "cloud"`, `crawler: "crawl4ai"`, the formatter's `modelName`, requested URL, and `receivedAt`. The current API contract does not supply final URL or capture time, so `finalUrl` and `capturedAt` stay null. Receipt time is labeled **Received**, not **Captured**. Browser interaction counts are absent, and the UI hides unavailable diagnostics. Historical browser/manual/legacy evidence and saved settings remain readable without a database schema migration.

`POST /api/scrape/preview` accepts only `{url}` and returns temporary cleaned Markdown without catalog/job/run writes. **Test URL** verifies collection and cleanup together. Copy/download, duration, characters, and cancellation remain available. Settings' **Test Markdown model** uses `/api/chat` with `purpose: "scrape"` and tests only the displayed model, including unsaved edits.

`POST /api/catalog/:sku/scrape` accepts only `{expectedRevision}` and uses the SKU's saved URL. Saving rechecks revision and row identity; concurrent edits, competing scrapes, or deletion/reimport cannot be overwritten. Failed retrieval/cleanup preserves previous Markdown/provenance. Source changes invalidate older URL evidence for automatic processing. Jobs snapshot evidence/configuration and retain SAP fallback and durable recovery. Restart recovery does not automatically repeat an interrupted scrape; start a fresh run explicitly.

## Boundaries and limits

- Public HTTP(S) URLs on port 80/443 only; no embedded credentials, private addresses, or local hostnames. Every initial DNS answer must be public. Crawl4AI performs page navigation remotely; the app no longer pins remote browser DNS or intercepts its subresources.
- API redirects are rejected. JSON must indicate `ok: true` and contain nonempty Markdown. Responses are capped at 4 MiB; Markdown is capped at 200,000 characters, including the final source footer.
- One active cloud retrieval, eight waiting requests, 60-second queue wait. Retrieval has a 120-second deadline after admission, including DNS and response reading. Admission is released before formatting.
- Cleanup has a separate 120-second deadline, including admission, at most two primary attempts within 60 seconds, and at most one backup attempt. Both stages honor cancellation and jobs' existing five-minute execution budget. Cancellation aborts fetch/body reading and releases admission. If both models are unavailable or cleanup output is invalid, the scrape still fails safely and preserves saved evidence.
- Fixed, sanitized errors distinguish missing/rejected keys, exhausted credit/allowance/spending caps, rate limits, blocked pages, login walls, page cooldowns, busy service, timeouts, network failure, and invalid content. Collection accepts known failure codes in either the gateway's `error` field or the collector's `reason` field, so a page's 403 does not incorrectly blame the API key. Allowlisted network codes aid diagnosis; raw upstream exceptions/messages are never exposed. Upstream authentication failures return 502 rather than application 401, so sessions stay signed in.

A successful page result cannot certify an entire website as fully scrapeable. Use SAP/manual evidence when retrieval fails. Existing partial/browser evidence remains readable; the new cloud collector accepts complete API responses only.

## Verify before rollout

The automated checks mock both providers and consume no API credits:

```bash
npm test
npm run build
TEST_DATABASE_URL=postgresql://... npm run test:security-db
TEST_DATABASE_URL=postgresql://... npm run test:qa-config-db
TEST_DATABASE_URL=postgresql://... npm run test:scrape-production
npm run setup:browser
npm run test:sap-editor
npm run test:catalog-browser
```

Always use a disposable database. The production smoke check starts the built bundle, creates/drops an isolated schema, and verifies previews, cloud provenance, revision protection, URL-only jobs, login, and saved-data compatibility with mocked cloud/model responses. `SCRAPER_TEST_IMAGE` optionally selects an already-built image for the same check; Docker execution must be verified on a host with Docker.

Once both credentials are configured, run one selected live case:

```bash
npm run test:scrape-live -- 'Jumbo — Galaxy S25'
```

The case-name filter selects from [the live manifest](../scripts/scraper-sites.json); omitting it tests all twelve URLs and spends more credits. Results and raw/cleaned Markdown go into an ignored `.cache` directory; no catalog data is saved. Check product identity, specifications, numbers, prices/currencies, and relevant source/manual links yourself as well as the script's fact assertions. The live checker uses the fresh-install model default; the application's Test URL uses the saved model setting. Prior [local-browser results](scraper-live-validation.md) are historical and do not validate cloud behavior.

## GLM cleanup verification — 9 October 2026

All four user-supplied URLs were tested through the application's preview handler on a loopback test server with real providers and the saved GLM setting. Each preview made exactly one cloud request. Settings were read with a read-only database connection; previews did not save catalog evidence or jobs. The final cleanup instructions were then checked against the complete captured Markdown using live GLM, without repeating cloud collection:

| Page | Raw characters | Cleaned characters | Final cleanup | Model attempts |
| --- | ---: | ---: | ---: | ---: |
| Samsung QA55QN90FAUXZN | 150,028 | 6,464 | 12.6 s | 1 |
| Amazon Hisense B0GQCXP6VM | 74,605 | 3,563 | 45.0 s | 2 |
| Carrefour Galaxy S25 Ultra | 3,352 | 1,609 | 3.5 s | 1 |
| SharafDG Y Intense 100 ml | No capture | — | Cloud retrieval cooldown | 0 |

All three final completions used low effort and ended with `finish_reason: "stop"` within the existing 120-second cleanup deadline. Inspection confirmed product identity, specifications, units, and source links; Samsung retained model-specific support and four manuals, while ambiguous GBP/USD prices were removed. Amazon retained AED 3,899.00 and the actual page-selected 75E8S variant despite the 65E8S URL slug. Carrefour retained stock status and specifications without inventing a price or transferring the page's unrelated S24 description to S25. Checks found no template placeholders, bank/trade-in/add-on promotions, or unrelated product/category/contact links in the final outputs.

Four-URL live acceptance remains incomplete: SharafDG returned a page-level 403 and then `reason: "cooldown"`, even though the same key passed the free balance check and other scrapes. The corrected app message reports this retrieval cooldown instead of claiming an invalid key. Intermittent model HTTP 500 responses also remain: one Amazon preview exhausted all three attempts; its final cleanup recheck succeeded after one retry. Default proxy/region settings and the existing retry/deadline limits were preserved.

Provider/scraper regressions, TypeScript, production build, settings/Scraper browser checks, and disposable-database evidence-preservation checks passed. Raw/cleaned Markdown and run records are in the ignored `.cache/glm-cleanup-acceptance/` directory. Docker and a deployed host were not checked.

## Samsung model-outage recovery — 9 October 2026

The saved scraping model was still the active `z-ai/glm-5.3-flash`; its gateway's intermittent HTTP 500 responses were the failing stage after successful Crawl4AI collection. Merely lowering reasoning effort or repeating the same model did not ensure recovery. JSON and SSE transport probes both succeeded while the service was healthy, so no streaming parser, chunking, or transport replacement was added.

After adding the bounded backup policy, the actual authenticated Codespaces application returned HTTP 200 for two full Samsung previews in 17.4 and 14.2 seconds. Both used the saved GLM model and preserved product QA55QN90FAUXZN, specifications, manual links, and the source footer without ambiguous prices or template placeholders. No catalog data or model settings were saved by these previews.

A separate preview-handler test forced both primary GLM attempts to return HTTP 500 while using real Crawl4AI collection and real DeepSeek cleanup. It returned HTTP 200 in 24.9 seconds, collected the 150,028-character page exactly once, produced 5,590 characters, recorded `deepseek/deepseek-v4.1-flash`, and displayed `MODEL_FALLBACK`. A direct backup check also completed with `finish_reason: "stop"` and retained product identity, specifications, and manuals.

Provider/scraper regressions cover bounded attempt counts, complete Unicode input on both models, credential isolation, custom-model recovery, primary timeout recovery, no switch on permanent/rate-limit errors, the total deadline, and both models failing safely. Browser settings/Scraper checks and disposable-database checks passed, including saving actual backup provenance and preserving prior Markdown, provenance, and revision when backup output is truncated. Diagnostics are in the ignored `.cache/samsung-model-fix/` directory. External failures affecting both models still fail safely; no change can promise that third-party services are always available.
