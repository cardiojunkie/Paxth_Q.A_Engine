# Scraper validation — 9 October 2026

Historical local-browser validation. That scraper and its setup/test commands have been retired. These results do not validate the current cloud pipeline; see [current configuration and checks](browser-scraper.md).

**Provider connectivity follow-up:** the shared AI Credits default now uses `https://aicredits.in/v1`. Both live `/api/chat` tests passed from the running Codespaces app on 9 October 2026: Q&A `deepseek/deepseek-v4.1-flash` in 2,915 ms and scraping `z-ai/glm-5.3-flash` in 3,680 ms. The documented API subdomain had failed with an IPv4 connection timeout and unavailable IPv6; the existing key was valid and had positive credits. These connectivity tests did not rerun the retailer targets below, whose recorded acceptance results remain unchanged.

Implementation checks pass; live retailer acceptance does **not** pass. No blocked, partial, or failed result was counted as successful extraction or saved into the catalog. No production deployment was performed.

## Automated checks

- `npm test`: passed, including independent settings, provider admission/retries, conversion failure validation, credential isolation, cancellation, and source/provenance handling. An initial cold-run descendant-cleanup assertion failed; the isolated rerun and full rerun passed without weakening the assertion.
- `npm run test:scrape-worker`: five checks passed.
- `npm run test:scrape-browser`: passed with real Crawl4AI/Chromium against local fixtures, including delayed specifications, tables, Unicode, bounded disclosure/scrolling, variants, blocks, unsafe redirects, partial results, English/Arabic Amazon recovery, and cancellation/descendant cleanup. Amazon fixtures use HTTPS and a disposable certificate trusted only by the test wrapper; production TLS checks remain enabled.
- `npm run setup:scraper -- --check`: real Chromium startup and Crawl4AI Markdown check passed.
- `npm run test:sap-editor` and `npm run test:catalog-browser`: passed, including uploads, model settings/tests, jobs, revision-safe saves, and exact XLSX exports. These UI checks use mocked APIs.
- `TEST_DATABASE_URL=… npm run test:security-db`: passed against a disposable local PostgreSQL 15 database. This exercises the real conversion pipeline with mocked browser/provider responses, QA and Catalog jobs, snapshotted models, SAP fallback, previous-evidence preservation on conversion failure, evidence reuse, conflicts, restart recovery, cancellation, and exports. Isolated schemas were dropped afterward; the production database was not used.
- `npm run build`: passed; Vite retains its existing large-chunk warning.
- `TEST_DATABASE_URL=… npm run test:scrape-production`: passed with the process tree restricted to one CPU via Linux affinity. Real public crawling plus mocked conversion/QA checked previews, login, evidence persistence, revisions, and a URL-only QA job. The measured concurrent-work interval was 69,481 ms and peak descendant RSS was 1,208.2 MiB. PostgreSQL and an external DISPLAY server are excluded.

The Compose configuration remains one CPU, 1,536 MiB memory, and 256 MiB shared memory. Docker is unavailable here: container builds, cgroup-enforced memory/CPU behavior, target-host retailer load, production backup restoration, and deployment remain unchecked. Affinity/RSS measurements are not a substitute for that container test. Finish or cancel active production runs before releasing the server and Chromium assets together.

## Live retailer run

Command: `SCRAPER_LIVE_OUTPUT=.cache/scraper-live-final-2026-10-09 npm run test:scrape-live`. The obsolete Jumbo S23 candidate returned only a breadcrumb, so a current S25 product replaced it in the manifest and was checked with `SCRAPER_LIVE_OUTPUT=.cache/scraper-jumbo-recheck npm run test:scrape-live -- 'Jumbo — Galaxy S25'`.

The twelve current product targets finished with **0 passed, 4 blocked, 8 failed**. The table also retains the rejected S23 candidate for auditability.

Every attempt used Crawl4AI 0.9.4 and selected `z-ai/glm-5.3-flash` through the existing AI Credits credentials, temperature 0.1, maximum 16,384 output tokens, and the normal deadlines/retries. Blocked or unloaded pages were never sent to conversion. Public access only; no proxies bought, CAPTCHA services, authentication, or catalog writes.

Times below are ISO 8601 in Asia/Kolkata (UTC+05:30). Start times and durations are exact recorded values. For failed conversions the original run did not retain the in-memory capture timestamp: the table explicitly labels the raw artifact write time instead. The live checker now retains capture timestamps on conversion failures for subsequent runs. Raw Markdown and full diagnostics are local artifacts under `.cache/scraper-live-final-2026-10-09/`.

| Product / exact submitted URL | Started | Capture / raw artifact time | Duration | Result | Cause |
| --- | --- | --- | ---: | --- | --- |
| [Noon — Galaxy S25](https://www.noon.com/uae-en/galaxy-s25-ai-dual-sim-silver-shadow-12gb-ram-256gb-5g-middle-east-version/N70140511V/p/) | 2026-10-09T11:15:08.129+05:30 | No usable capture | 50.264 s | **failed** | `PAGE_UNAVAILABLE` |
| [Noon — iPhone 16](https://www.noon.com/uae-en/iphone-16-128gb-black-5g-with-facetime-international-version/N70106131V/p/?o=cd3d8e6bfd17200a) | 2026-10-09T11:15:58.398+05:30 | No usable capture | 57.648 s | **failed** | `PAGE_UNAVAILABLE` |
| [Amazon — Galaxy S24 Ultra](https://www.amazon.ae/SAMSUNG-Storage-Titanium-Android-Smartphone/dp/B0CQZ22Q7L) | 2026-10-09T11:16:56.048+05:30 | No usable capture | 32.052 s | **blocked** | `PAGE_BLOCKED` |
| [Amazon — Galaxy A16](https://www.amazon.ae/Samsung-Storage-Security-Updates-5000mAh/dp/B0DJMKSSW2) | 2026-10-09T11:17:28.102+05:30 | No usable capture | 44.037 s | **blocked** | `PAGE_BLOCKED` |
| [Carrefour — Samsung 459L fridge](https://www.carrefouruae.com/mafuae/en/fridge-401l-to-500l/samsung-fridge-rb50dg632es9ae-459l/p/2164728) | 2026-10-09T11:18:12.144+05:30 | 2026-10-09T11:19:09.442+05:30 (artifact write) | 61.102 s | **failed** | `CONVERSION_FAILED` |
| [Carrefour — Samsung 500L fridge](https://www.carrefouruae.com/mafuae/en/fridge-401l-to-500l/samsung-500l-gross-capacity-refrigerator-rt50cg6400s9sg-refined-inox-silver/p/8806094920956?offer=offer_1024118555&sellerId=18555&sid=DEFAULT) | 2026-10-09T11:19:13.248+05:30 | 2026-10-09T11:20:12.036+05:30 (artifact write) | 62.575 s | **failed** | `CONVERSION_FAILED` |
| [Sharaf DG — Samsung washer](https://uae.sharafdg.com/product/samsung-front-load-washer-9-kg-ww90dg5u34aegu/) | 2026-10-09T11:20:15.830+05:30 | No usable capture | 44.940 s | **blocked** | `PAGE_BLOCKED` |
| [Sharaf DG — Galaxy A36](https://uae.sharafdg.com/product/samsung-galaxy-a36-5g-128gb-6gb-ram-awesome-lavender-smartphone/) | 2026-10-09T11:21:00.773+05:30 | No usable capture | 52.446 s | **blocked** | `PAGE_BLOCKED` |
| [Lulu — iPhone 17 Pro Max](https://gcc.luluhypermarket.com/en-ae/apple-iphone-17-pro-max-5g-smartphone-1-tb-storage-deep-blue/p/2565687/?color=Deep+Blue) | 2026-10-09T11:21:53.220+05:30 | 2026-10-09T11:22:40.166+05:30 (artifact write) | 50.766 s | **failed** | `CONVERSION_FAILED` |
| [Lulu — Galaxy A36](https://gcc.luluhypermarket.com/en-ae/samsung-galaxy-a36-5g-smartphone-8-ram-awesome-lime/p/2452038/?color=Awesome+Lime) | 2026-10-09T11:22:43.988+05:30 | 2026-10-09T11:23:49.294+05:30 (artifact write) | 69.103 s | **failed** | `CONVERSION_FAILED` |
| [Jumbo — iPhone 16](https://www.jumbo.ae/apple-iphone-16-smartphone-ultramarine-512-gb.html) | 2026-10-09T11:23:53.099+05:30 | 2026-10-09T11:24:37.461+05:30 (artifact write) | 48.143 s | **failed** | `CONVERSION_FAILED` |
| [Jumbo — Galaxy S23 Ultra](https://www.jumbo.ae/samsung-galaxy-s23-ultra-5g-smartphone-cream-256-gb-10126320.html) | 2026-10-09T11:24:41.244+05:30 | 2026-10-09T11:25:14.179+05:30 (artifact write) | 36.699 s | **failed** | `CONVERSION_FAILED` |
| [Jumbo — Galaxy S25](https://www.jumbo.ae/samsung-galaxy-s25-5g-smartphone-navy-256-gb.html) | 2026-10-09T11:26:24.640+05:30 | 2026-10-09T11:26:43.661+05:30 | 22.796 s | **failed** | `CONVERSION_FAILED` |

A failed conversion means no structured output exists to compare against the captured page. AI Credits connection attempts from this workspace returned timeouts; that does not establish a service-wide outage. Both Amazon and Sharaf DG pairs returned access challenges and were rejected. The raw artifacts are diagnostic evidence only, not saved job evidence.

## Factual inspection

- Earlier Noon Galaxy S25 preview: captured at **2026-10-09T02:00:55.144+05:30**, model `z-ai/glm-5.3-flash`, **64.910 s**, **partial**. Model output matched the captured Galaxy S25 / 12 GB / 256 GB identity, model number, numeric product price 2733.17, and the exact server-appended source URL. It dropped the private-use currency glyph and misinterpreted merged seller-rating text. The formatter instructions were tightened to preserve unfamiliar currency symbols and omit ambiguous merged values and seller reputation metrics. That revised prompt still requires a successful live factual recheck. This preview was never eligible for job evidence.
- Carrefour 459 L raw capture: Samsung RB50DG632ES9A identity, 459 L total / 122 L freezer / 337 L fridge, 382 kWh, and AED 2,647.99 (with the original AED 3,359.00 also present). Requested source link matches. Conversion failed; no model-fidelity pass is claimed.
- Carrefour 500 L raw capture: RT50CG6400S9SG, gross 500 L / net 388 L, and AED 1,748.10 (original AED 2,699.00). The offer/seller query values and source link are retained. Conversion failed; no model-fidelity pass is claimed. Both Carrefour captures retain unresolved cookie-dialog diagnostics and cannot become saved job evidence.
- Lulu iPhone raw capture: requested iPhone 17 Pro Max, 1 TB, Deep Blue, 6.9-inch OLED, A19 Pro, and numeric price 6,799.00 are present; the currency graphic has no readable currency text in the Markdown. Exact source link matches. Conversion failed; currency/model-output fidelity remains unverified.
- Lulu Galaxy A36 raw capture: requested 256 GB / Awesome Lime, Snapdragon 6 Gen 3, 5000 mAh, out-of-stock status, and numeric price 1,419.00 are present. Currency is not readable text. Specifications/disclosure controls remain unresolved, so this capture is partial regardless of conversion. Source link matches.
- Jumbo iPhone raw capture: requested Ultramarine / 512 GB, SKU IPH16-512GB-UMR, 6.1-inch screen, 48 MP rear camera, out-of-stock status, and literal price `D 4,649.00` are present. Other variant prices remain separate in the capture. Source link matches. Readiness did not settle, so it is partial; conversion also failed.
- Jumbo S25 replacement capture: requested Navy / 256 GB, 4000 mAh, 12 GB RAM, out-of-stock status, and literal price `D 3,449.00` are present. The page itself contains conflicting 6.1-inch highlight / 6.2-inch specification values; a formatter must preserve that disagreement. The source link matches. Readiness remained partial and conversion failed. Its raw artifact and exact capture metadata are in `.cache/scraper-jumbo-recheck/`. The rejected S23 URL supplied no useful specifications or price.

Earlier attempts are retained in `.cache/scraper-live-2026-10-09/`. In addition to the Noon partial preview, both Carrefour model calls reached the 120-second conversion deadline; Amazon and Sharaf DG were blocked. These earlier results are not counted as passes.

## Reproduce before release

Restore connectivity to the configured AI Credits gateway, rerun `npm run test:scrape-live`, and inspect each raw/structured pair for exact product/variant, specifications, price/currency, and source links. A text capture alone is insufficient for a pass. Retailer challenges and incomplete disclosures require the existing manual-evidence/SAP fallback. Then build and smoke-test the production image on the deployment host with its actual limits before releasing it.
