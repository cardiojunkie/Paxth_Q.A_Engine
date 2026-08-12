import express from "express";
import path from "path";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { launch } from "cloakbrowser";
import { getBlockedScrapeReason } from "./src/lib/blockedScrapePage.js";
import { captureDynamicTabs } from "./src/lib/captureDynamicTabs.js";
import { isCompleteWebsiteDomain, normalizeWebsite } from "./src/lib/siteSelectorWebsite.js";
import { loadLazyPageContent } from "./src/lib/loadLazyPageContent.js";
import { db } from "./src/db/index.js";
import { skuData, attributeSets, jobs, siteSelectors } from "./src/db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Database Health Check Endpoint
  app.get("/api/db-status", async (req, res) => {
    if (!db) {
      return res.status(503).json({ status: "disconnected", message: "DATABASE_URL is not configured." });
    }
    try {
      // Test query
      await db.select().from(skuData).limit(1);
      return res.json({ status: "connected", message: "Database connection successful." });
    } catch (e: any) {
      return res.status(500).json({ status: "error", message: e.message });
    }
  });

  // Error handler for bad JSON payloads
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: "Invalid JSON payload format" });
    }
    next(err);
  });

  

  // Auto-migrate tables on start
  if (db) {
    const runMigrate = async (query: any) => {
      try {
        await db.execute(query);
      } catch (e: any) {
        // ignore migration step if constraint or column already modified
      }
    };

    await runMigrate(sql`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attribute_set TEXT,
          skus JSONB,
          status TEXT DEFAULT 'pending',
          tokens_used JSONB,
          time_taken INTEGER,
          error TEXT
        );
    `);
    await runMigrate(sql`ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_attribute_sets_id_fk;`);
    await runMigrate(sql`ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_attribute_set_id_fkey;`);
    await runMigrate(sql`ALTER TABLE jobs ALTER COLUMN created_at TYPE TEXT USING created_at::text;`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attribute_set TEXT;`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skus JSONB;`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tokens_used JSONB;`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_taken INTEGER;`);
    await runMigrate(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error TEXT;`);
    await runMigrate(sql`ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS qa_result JSONB;`);
    await runMigrate(sql`ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS export_data JSONB;`);
    await runMigrate(sql`ALTER TABLE sku_data ADD COLUMN IF NOT EXISTS last_job_id TEXT;`);
    await runMigrate(sql`
        CREATE TABLE IF NOT EXISTS site_selectors (
          id TEXT PRIMARY KEY,
          website TEXT NOT NULL,
          selectors TEXT NOT NULL,
          tab_selector TEXT,
          tab_content_selector TEXT,
          tab_wait_ms INTEGER,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
    `);
    await runMigrate(sql`ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_selector TEXT;`);
    await runMigrate(sql`ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_content_selector TEXT;`);
    await runMigrate(sql`ALTER TABLE site_selectors ADD COLUMN IF NOT EXISTS tab_wait_ms INTEGER;`);
    console.log("Database schema initialized.");
  }

  // --- SKU Data Endpoints ---
  app.get("/api/catalog", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const data = await db.select().from(skuData);
      const mapped = data.map(row => ({
        sku: row.sku,
        upload_attributes: row.uploadAttributes,
        source: row.source,
        raw_row: row.rawRow,
        status: row.status,
        attribute_set: row.attributeSet || row.attributeSetId,
        scraped_markdown: row.scrapedMarkdown,
        scrape_status: row.scrapeStatus,
        tokensUsed: row.tokensUsed,
        timeTaken: row.timeTaken,
        error: row.error,
        qa_result: row.qaResult || (row.rawRow && (row.rawRow as any).qa_result) || undefined,
        export_data: row.exportData || undefined,
        last_job_id: row.lastJobId || undefined
      }));
      res.json(mapped);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/catalog", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const items = req.body; // array of skus
      const toInsert = items.map((item: any) => ({
        sku: item.sku,
        uploadAttributes: item.upload_attributes,
        source: item.source,
        rawRow: item.raw_row,
        status: item.status || 'pending',
        attributeSet: item.attribute_set || null,
        attributeSetId: item.attribute_set || null,
        scrapedMarkdown: item.scraped_markdown || null,
        scrapeStatus: item.scrape_status || null,
        tokensUsed: item.tokensUsed || null,
        timeTaken: item.timeTaken || null,
        error: item.error || null,
        qaResult: item.qa_result || null,
        exportData: item.export_data || null,
        lastJobId: item.last_job_id || null
      }));
      
      // Upsert using onConflictDoUpdate
      for (const item of toInsert) {
        await db.insert(skuData).values(item).onConflictDoUpdate({
          target: skuData.sku,
          set: {
            uploadAttributes: sql`EXCLUDED.upload_attributes`,
            source: sql`EXCLUDED.source`,
            rawRow: sql`EXCLUDED.raw_row`,
            status: sql`EXCLUDED.status`,
            attributeSet: sql`COALESCE(EXCLUDED.attribute_set, sku_data.attribute_set)`,
            attributeSetId: sql`COALESCE(EXCLUDED.attribute_set_id, sku_data.attribute_set_id)`,
            scrapedMarkdown: sql`COALESCE(EXCLUDED.scraped_markdown, sku_data.scraped_markdown)`,
            scrapeStatus: sql`COALESCE(EXCLUDED.scrape_status, sku_data.scrape_status)`,
            tokensUsed: sql`COALESCE(EXCLUDED.tokens_used, sku_data.tokens_used)`,
            timeTaken: sql`COALESCE(EXCLUDED.time_taken, sku_data.time_taken)`,
            error: sql`COALESCE(EXCLUDED.error, sku_data.error)`,
            qaResult: sql`COALESCE(EXCLUDED.qa_result, sku_data.qa_result)`,
            exportData: sql`COALESCE(EXCLUDED.export_data, sku_data.export_data)`,
            lastJobId: sql`COALESCE(EXCLUDED.last_job_id, sku_data.last_job_id)`
          }
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/catalog/:sku", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { sku } = req.params;
      const item = req.body;
      const toUpdate: Record<string, any> = {};

      if (item.upload_attributes !== undefined) toUpdate.uploadAttributes = item.upload_attributes;
      if (item.source !== undefined) toUpdate.source = item.source;
      if (item.raw_row !== undefined) toUpdate.rawRow = item.raw_row;
      if (item.status !== undefined) toUpdate.status = item.status;
      if (item.attribute_set !== undefined) {
        toUpdate.attributeSet = item.attribute_set;
        toUpdate.attributeSetId = item.attribute_set;
      }
      if (item.scraped_markdown !== undefined) toUpdate.scrapedMarkdown = item.scraped_markdown;
      if (item.scrape_status !== undefined) toUpdate.scrapeStatus = item.scrape_status;
      if (item.tokensUsed !== undefined) toUpdate.tokensUsed = item.tokensUsed;
      if (item.timeTaken !== undefined) toUpdate.timeTaken = item.timeTaken;
      if (item.error !== undefined) toUpdate.error = item.error;
      if (item.qa_result !== undefined) toUpdate.qaResult = item.qa_result;
      if (item.export_data !== undefined) toUpdate.exportData = item.export_data;
      if (item.last_job_id !== undefined) toUpdate.lastJobId = item.last_job_id;

      if (Object.keys(toUpdate).length > 0) {
        await db.update(skuData).set(toUpdate).where(eq(skuData.sku, sku));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/catalog", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { skus, all } = req.body || {};
      if (all) {
        await db.delete(skuData);
      } else if (skus && Array.isArray(skus) && skus.length > 0) {
        await db.delete(skuData).where(inArray(skuData.sku, skus));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Jobs Endpoints ---
  app.get("/api/jobs", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const data = await db.select().from(jobs);
      const mapped = data.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        attribute_set: row.attributeSet || "",
        skus: (row.skus as string[]) || [],
        status: row.status || "pending",
        tokensUsed: row.tokensUsed || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        timeTaken: row.timeTaken || 0,
        error: row.error || undefined
      }));
      res.json(mapped);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const items = Array.isArray(req.body) ? req.body : [req.body];
      for (const item of items) {
        const val = {
          id: item.id,
          name: item.name,
          createdAt: item.createdAt || new Date().toISOString(),
          attributeSet: item.attribute_set || null,
          skus: item.skus || [],
          status: item.status || 'pending',
          tokensUsed: item.tokensUsed || null,
          timeTaken: item.timeTaken || null,
          error: item.error || null
        };
        await db.insert(jobs).values(val).onConflictDoUpdate({
          target: jobs.id,
          set: {
            name: sql`EXCLUDED.name`,
            createdAt: sql`EXCLUDED.created_at`,
            attributeSet: sql`EXCLUDED.attribute_set`,
            skus: sql`EXCLUDED.skus`,
            status: sql`EXCLUDED.status`,
            tokensUsed: sql`EXCLUDED.tokens_used`,
            timeTaken: sql`EXCLUDED.time_taken`,
            error: sql`EXCLUDED.error`
          }
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/jobs/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { id } = req.params;
      const item = req.body;
      const toUpdate: Record<string, any> = {};

      if (item.name !== undefined) toUpdate.name = item.name;
      if (item.attribute_set !== undefined) toUpdate.attributeSet = item.attribute_set;
      if (item.skus !== undefined) toUpdate.skus = item.skus;
      if (item.status !== undefined) toUpdate.status = item.status;
      if (item.tokensUsed !== undefined) toUpdate.tokensUsed = item.tokensUsed;
      if (item.timeTaken !== undefined) toUpdate.timeTaken = item.timeTaken;
      if (item.error !== undefined) toUpdate.error = item.error;

      if (Object.keys(toUpdate).length > 0) {
        await db.update(jobs).set(toUpdate).where(eq(jobs.id, id));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { id } = req.params;
      await db.delete(jobs).where(eq(jobs.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/jobs", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { ids, all } = req.body || {};
      if (all) {
        await db.delete(jobs);
      } else if (ids && Array.isArray(ids) && ids.length > 0) {
        await db.delete(jobs).where(inArray(jobs.id, ids));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Site Selector Endpoints ---
  const matchesWebsite = (hostname: string, website: string) => {
    const host = hostname.replace(/^www\./, "");
    const prefix = normalizeWebsite(website);
    return host === prefix || host.endsWith(`.${prefix}`);
  };

  const mapSiteSelector = (rule: typeof siteSelectors.$inferSelect) => ({
    id: rule.id,
    website: normalizeWebsite(rule.website),
    selectors: rule.selectors,
    tabSelector: rule.tabSelector || undefined,
    tabContentSelector: rule.tabContentSelector || undefined,
    tabWaitMs: rule.tabWaitMs ?? 300,
    enabled: rule.enabled,
    createdAt: rule.createdAt.getTime(),
    updatedAt: rule.updatedAt.getTime(),
  });

  const parseSiteSelectorInput = (body: any) => {
    const websiteInput = String(body?.website || "");
    const website = normalizeWebsite(websiteInput);
    const selectors = String(body?.selectors || "").trim();
    const tabSelector = String(body?.tabSelector || "").trim() || null;
    const tabContentSelector = String(body?.tabContentSelector || "").trim() || null;
    const tabWaitMs = body?.tabWaitMs === undefined || body?.tabWaitMs === ""
      ? 300
      : Number(body.tabWaitMs);
    let error = "";
    if (!websiteInput.trim() || !selectors) error = "website and selectors are required";
    else if (!isCompleteWebsiteDomain(websiteInput)) error = "website must be a complete domain, for example tcl.com";
    else if (Boolean(tabSelector) !== Boolean(tabContentSelector)) {
      error = "tabSelector and tabContentSelector must be provided together";
    } else if (!Number.isInteger(tabWaitMs) || tabWaitMs < 0 || tabWaitMs > 10000) {
      error = "tabWaitMs must be an integer from 0 to 10000";
    }
    return { website, selectors, tabSelector, tabContentSelector, tabWaitMs, error };
  };

  app.get("/api/site-selectors", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      res.json((await db.select().from(siteSelectors)).map(mapSiteSelector));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/site-selectors", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    const input = parseSiteSelectorInput(req.body);
    if (!req.body?.id) return res.status(400).json({ error: "id is required" });
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const now = new Date();
      const duplicate = (await db.select().from(siteSelectors))
        .find(rule => normalizeWebsite(rule.website) === input.website);
      if (duplicate) return res.status(409).json({ error: `A rule for ${input.website} already exists` });
      const rule = {
        id: req.body.id,
        website: input.website,
        selectors: input.selectors,
        tabSelector: input.tabSelector,
        tabContentSelector: input.tabContentSelector,
        tabWaitMs: input.tabWaitMs,
        enabled: req.body.enabled !== false,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(siteSelectors).values(rule);
      res.status(201).json(mapSiteSelector(rule));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/site-selectors/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    const input = parseSiteSelectorInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const duplicate = (await db.select().from(siteSelectors))
        .find(rule => rule.id !== req.params.id && normalizeWebsite(rule.website) === input.website);
      if (duplicate) return res.status(409).json({ error: `A rule for ${input.website} already exists` });
      const [updated] = await db.update(siteSelectors).set({
        website: input.website,
        selectors: input.selectors,
        tabSelector: input.tabSelector,
        tabContentSelector: input.tabContentSelector,
        tabWaitMs: input.tabWaitMs,
        enabled: req.body.enabled !== false,
        updatedAt: new Date(),
      }).where(eq(siteSelectors.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Site selector rule not found" });
      res.json(mapSiteSelector(updated));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/site-selectors/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      await db.delete(siteSelectors).where(eq(siteSelectors.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Scraping endpoint
  app.post("/api/scrape", async (req, res) => {
    try {
      let { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      try {
        new URL(url);
      } catch (e) {
        return res.status(400).json({ error: "Invalid URL provided", details: url });
      }

      const hostname = new URL(url).hostname.toLowerCase();
      let selectorRule: typeof siteSelectors.$inferSelect | undefined;
      if (db) {
        try {
          selectorRule = (await db.select().from(siteSelectors))
            .filter(rule => rule.enabled && matchesWebsite(hostname, rule.website))
            .sort((a, b) => normalizeWebsite(b.website).length - normalizeWebsite(a.website).length)[0];
        } catch (e: any) {
          console.error("Failed to load site selectors:", e.message);
          return res.status(500).json({ error: "Failed to load site selector rules", details: e.message });
        }
      }

      let browser;
      try {
        // Fetch HTML with CloakBrowser
        browser = await launch({ headless: true });
        const page = await browser.newPage();
        
        // Navigate and wait for network to be idle to ensure dynamic content loads
        const navigationResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Try to wait for network idle to get SPAs, but don't fail if it times out
        try {
          await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) {
          // Ignore timeout on networkidle
        }

        let html = await page.content();
        const blockedReason = getBlockedScrapeReason({
          status: navigationResponse?.status(),
          hostname,
          html,
        });
        if (blockedReason) {
          return res.status(502).json({
            error: blockedReason,
            details: "Use SAP or manually supplied source content for this QA run.",
          });
        }

        if (/(^|\.)amazon\./i.test(hostname)) {
          await loadLazyPageContent(page);
          html = await page.content();
        }

        if (selectorRule && Boolean(selectorRule.tabSelector) !== Boolean(selectorRule.tabContentSelector)) {
          return res.status(422).json({ error: `Incomplete tab selector configuration for ${selectorRule.website}` });
        }
        if (selectorRule?.tabSelector && selectorRule.tabContentSelector) {
          try {
            await captureDynamicTabs(page, {
              tabSelector: selectorRule.tabSelector,
              panelSelector: selectorRule.tabContentSelector,
              waitMs: selectorRule.tabWaitMs ?? 300,
            });
          } catch (error: any) {
            return res.status(422).json({
              error: `Could not capture specification tabs for ${selectorRule.website}`,
              details: error.message || String(error),
            });
          }
          html = await page.content();
        }
        
        const $ = cheerio.load(html);

        // Remove irrelevant elements
        $('header, footer, nav, aside, script, style, noscript, svg, [role="banner"], [role="contentinfo"], .related-products, .recommendations, .cookie-banner, .ads').remove();

        let cleanHtml = $.html();
        if (selectorRule) {
          let selected;
          try {
            selected = $(selectorRule.selectors);
          } catch {
            return res.status(422).json({ error: `Invalid selector for ${selectorRule.website}` });
          }
          if (!selected.length) return res.status(422).json({ error: `Selector matched no content for ${selectorRule.website}` });
          cleanHtml = selected.toString();
        }

        // Convert to Markdown
        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced'
        });
        
        const markdown = turndownService.turndown(cleanHtml);

        return res.json({ markdown });
      } finally {
        if (browser) {
          await browser.close().catch(console.error);
        }
      }
    } catch (error: any) {
      console.error("Scraping error:", error.message);
      return res.status(500).json({ error: "Failed to scrape URL", details: error.message });
    }
  });

  // LLM Proxy endpoint to bypass CORS
  app.post("/api/chat", async (req, res) => {
    try {
      const { baseUrl, apiKey, payload } = req.body;
      if (!baseUrl || !payload) {
        return res.status(400).json({ error: "baseUrl and payload are required" });
      }

      let cleanBaseUrl = String(baseUrl).trim().replace(/\/+$/, '');
      let endpoint = cleanBaseUrl.endsWith('/chat/completions')
        ? cleanBaseUrl
        : `${cleanBaseUrl}/chat/completions`;

      let currentPayload = { ...payload };
      let attempts = 0;
      const maxServerAttempts = 3;
      let lastResponse: Response | null = null;
      let lastErrorText = "";

      while (attempts < maxServerAttempts) {
        attempts++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000); // 90s per request attempt

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey && { "Authorization": `Bearer ${apiKey}` })
            },
            body: JSON.stringify(currentPayload),
            signal: controller.signal
          });
          clearTimeout(timeout);
          lastResponse = response;

          if (response.ok) {
            const text = await response.text();
            try {
              const data = JSON.parse(text);
              return res.json(data);
            } catch (e) {
              return res.status(502).json({ error: "Invalid JSON response from LLM API", details: text.substring(0, 200) });
            }
          }

          lastErrorText = await response.text();

          // If status >= 400 and response_format was set, remove it and retry
          if (response.status >= 400 && currentPayload.response_format) {
            console.warn(`[Proxy Chat] Endpoint returned ${response.status} with response_format. Removing response_format and retrying...`);
            delete currentPayload.response_format;
          }

          // If status >= 400 and user content is very long, truncate user content
          if (response.status >= 400 && Array.isArray(currentPayload.messages) && currentPayload.messages.length > 0) {
            const lastMsg = currentPayload.messages[currentPayload.messages.length - 1];
            if (lastMsg && typeof lastMsg.content === 'string' && lastMsg.content.length > 12000) {
              console.warn(`[Proxy Chat] Endpoint returned ${response.status} with content length ${lastMsg.content.length}. Truncating to 12000 chars...`);
              lastMsg.content = lastMsg.content.substring(0, 12000) + "\n...[TRUNCATED BY PROXY FOR COMPATIBILITY]...";
            }
          }

          // If status is retryable (429, 500, 502, 503, 504) and we have retries left
          if (response.status >= 400 && response.status !== 401 && response.status !== 402 && response.status !== 403 && attempts < maxServerAttempts) {
            const delay = attempts * 1000;
            console.warn(`[Proxy Chat] Endpoint returned ${response.status}. Retrying in ${delay}ms (attempt ${attempts}/${maxServerAttempts})...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          break;
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          lastErrorText = fetchErr.message || String(fetchErr);
          if (attempts < maxServerAttempts) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
        }
      }

      let cleanDetails = lastErrorText;
      try {
        const parsed = JSON.parse(lastErrorText);
        if (parsed.error) {
          if (typeof parsed.error === "string") cleanDetails = parsed.error;
          else if (parsed.error.message) cleanDetails = parsed.error.message;
          else cleanDetails = JSON.stringify(parsed.error);
        } else if (parsed.message) {
          cleanDetails = parsed.message;
        }
      } catch (e) {
        // Not JSON
      }

      const status = lastResponse ? lastResponse.status : 500;
      return res.status(status).json({
        error: `LLM API returned ${status}`,
        details: cleanDetails || "Internal Server Error"
      });

    } catch (error: any) {
      console.error("LLM Proxy error:", error.message);
      return res.status(500).json({ error: "Failed to communicate with LLM API", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
