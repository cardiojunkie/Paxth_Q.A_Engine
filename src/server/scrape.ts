import * as cheerio from "cheerio";
import { launch } from "cloakbrowser";
import TurndownService from "turndown";
import { getBlockedScrapeReason } from "../lib/blockedScrapePage.js";
import { captureDynamicTabs } from "../lib/captureDynamicTabs.js";
import { loadLazyPageContent } from "../lib/loadLazyPageContent.js";
import { requirePublicHttpsUrl } from "./outbound.js";

type SelectorRule = {
  website: string;
  selectors: string;
  tabSelector?: string | null;
  tabContentSelector?: string | null;
  tabWaitMs?: number | null;
};

let browserQueue = Promise.resolve();

export function scrapeProduct(urlInput: string, timeout: number, maxLength: number, selector?: SelectorRule) {
  const run = browserQueue.then(() => scrape(urlInput, timeout, maxLength, selector));
  browserQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function scrape(urlInput: string, timeout: number, maxLength: number, selector?: SelectorRule) {
  const deadline = Date.now() + 45000;
  const navigationTimeout = Math.min(45000, Math.max(5000, Number.isFinite(timeout) ? timeout : 45000));
  const hostChecks = new Map<string, Promise<void>>();
  const validateResource = async (raw: string) => {
    let candidate: URL;
    try { candidate = new URL(raw); } catch { throw new Error("Invalid resource URL"); }
    if (raw.length > 2048 || candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.hash || (candidate.port && candidate.port !== "443")) {
      throw new Error("Blocked resource URL");
    }
    const hostname = candidate.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    let check = hostChecks.get(hostname);
    if (!check) {
      check = requirePublicHttpsUrl(`https://${candidate.host}/`).then(() => undefined);
      hostChecks.set(hostname, check);
    }
    await check;
    return candidate;
  };
  const url = await withinDeadline(validateResource(urlInput), deadline);
  const browser = await withinDeadline(launch({ headless: true }), deadline);
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await withinDeadline(browser.newContext({ serviceWorkers: "block", acceptDownloads: false }), deadline);
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await withinDeadline(context.newPage(), deadline);
    const blockedTypes = new Set(["image", "media", "font", "websocket"]);
    let requestCount = 0;
    let requestLimitExceeded = false;
    await page.route("**/*", async (route) => {
      try {
        requestCount++;
        if (requestCount > 200) requestLimitExceeded = true;
        if (requestLimitExceeded || blockedTypes.has(route.request().resourceType())) throw new Error("Blocked resource");
        await withinDeadline(validateResource(route.request().url()), deadline);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const response = await withinDeadline(page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: Math.min(navigationTimeout, remaining(deadline)) }), deadline);
    if (requestLimitExceeded) throw new Error("Scraped page exceeded the request limit");
    let html = await withinDeadline(page.content(), deadline);
    checkHtmlSize(html);
    const blockedReason = getBlockedScrapeReason({ status: response?.status(), hostname: url.hostname, html });
    if (blockedReason) throw new Error(blockedReason);
    if (/(^|\.)amazon\./i.test(url.hostname)) {
      await withinDeadline(loadLazyPageContent(page), deadline);
      html = await withinDeadline(page.content(), deadline);
    }
    if (selector?.tabSelector && selector.tabContentSelector) {
      await withinDeadline(captureDynamicTabs(page, {
        tabSelector: selector.tabSelector,
        panelSelector: selector.tabContentSelector,
        waitMs: selector.tabWaitMs ?? 300,
      }), deadline);
      html = await withinDeadline(page.content(), deadline);
    }
    if (requestLimitExceeded) throw new Error("Scraped page exceeded the request limit");
    checkHtmlSize(html);
    remaining(deadline);
    const $ = cheerio.load(html);
    $("header, footer, nav, aside, script, style, noscript, svg, [role=banner], [role=contentinfo], .related-products, .recommendations, .cookie-banner, .ads").remove();
    const selected = selector?.selectors ? $(selector.selectors) : null;
    if (selected && !selected.length) throw new Error(`Selector matched no content for ${selector.website}`);
    const selectedHtml = selected ? selected.toString() : $.root().toString();
    const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(selectedHtml);
    remaining(deadline);
    if (requestLimitExceeded) throw new Error("Scraped page exceeded the request limit");
    return markdown.slice(0, maxLength);
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function remaining(deadline: number) {
  const milliseconds = deadline - Date.now();
  if (milliseconds <= 0) throw new Error("Scraping timed out");
  return milliseconds;
}

async function withinDeadline<T>(operation: Promise<T>, deadline: number) {
  const milliseconds = remaining(deadline);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Scraping timed out")), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkHtmlSize(html: string) {
  if (Buffer.byteLength(html, "utf8") > 5 * 1024 * 1024) throw new Error("Scraped page exceeded the HTML size limit");
}
