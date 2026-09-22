import express from "express";
import path from "node:path";
import { eq } from "drizzle-orm";
import { pool, db } from "./src/db/index.js";
import { siteSelectors } from "./src/db/schema.js";
import { initializeQaConfiguration, registerQaConfigurationRoutes } from "./src/db/qaConfiguration.js";
import { isCompleteWebsiteDomain, normalizeWebsite } from "./src/lib/siteSelectorWebsite.js";
import { scrapeWithAgent, ScrapeError, validateScrapeInput } from "./src/lib/scrapeAgent.js";
import { ProviderError } from "./src/lib/chatCompletion.js";
import { initializeDatabase, verifySchema } from "./src/server/database.js";
import { ApiError, registerCatalogRoutes } from "./src/server/catalog.js";
import { initializeAuth, registerAuth } from "./src/server/auth.js";
import { initializeProvider, registerProviderRoutes, getProviderSettings, getProviderCredentials } from "./src/server/provider.js";
import { initializeJobRuns, registerJobRunRoutes, startJobWorker } from "./src/server/jobRunner.js";

async function startServer() {
  if (!pool || !db) throw new Error("DATABASE_URL is required");
  await initializeDatabase(pool);
  await initializeQaConfiguration(db);
  await initializeAuth(pool);
  await initializeProvider(pool);
  await initializeJobRuns(pool);
  await verifySchema(pool);
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.disable('x-powered-by');
  app.use(express.json({limit:'50mb'}));
  app.get('/healthz', async (_req,res) => {
    try { await verifySchema(pool); res.json({status:'ready'}); }
    catch { res.status(503).json({status:'unavailable'}); }
  });
  registerAuth(app,pool);
  app.get('/api/db-status', async (_req,res) => {
    try { await verifySchema(pool); res.json({status:'connected',message:'Database schema ready'}); }
    catch { res.status(503).json({status:'error',message:'Database schema unavailable'}); }
  });
  registerQaConfigurationRoutes(app,db);
  registerCatalogRoutes(app,pool);
  registerProviderRoutes(app,pool);
  registerJobRunRoutes(app,pool);
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.website !== 'string' || typeof body.selectors !== 'string' ||
      ['tabSelector','tabContentSelector'].some(key => body[key] != null && typeof body[key] !== 'string') ||
      (body.enabled !== undefined && typeof body.enabled !== 'boolean')) error = "Invalid site selector fields";
    else if (!websiteInput.trim() || !selectors) error = "website and selectors are required";
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
      const duplicate = e.code === "23505" || e.cause?.code === "23505";
      res.status(duplicate ? 409 : 503).json({ error: duplicate ? "A selector for that website already exists" : "Site selector operation failed" });
    }
  });

  app.post("/api/site-selectors", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    const input = parseSiteSelectorInput(req.body);
    if (typeof req.body?.id !== "string" || !req.body.id.trim() || req.body.id.length > 256) return res.status(400).json({ error: "id is required" });
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const now = new Date();
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
      const duplicate = e.code === "23505" || e.cause?.code === "23505";
      res.status(duplicate ? 409 : 503).json({ error: duplicate ? "A selector for that website already exists" : "Site selector operation failed" });
    }
  });

  app.put("/api/site-selectors/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    const input = parseSiteSelectorInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    try {
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
      const duplicate = e.code === "23505" || e.cause?.code === "23505";
      res.status(duplicate ? 409 : 503).json({ error: duplicate ? "A selector for that website already exists" : "Site selector operation failed" });
    }
  });

  app.delete("/api/site-selectors/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const removed = await db.delete(siteSelectors).where(eq(siteSelectors.id, req.params.id)).returning();
      if (!removed.length) return res.status(404).json({ error:"Site selector not found" });
      res.json({ success: true });
    } catch (e: any) {
      const duplicate = e.code === "23505" || e.cause?.code === "23505";
      res.status(duplicate ? 409 : 503).json({ error: duplicate ? "A selector for that website already exists" : "Site selector operation failed" });
    }
  });

  // Every scrape entry point shares the same agent and evidence contract.
  app.post("/api/scrape", async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnect);
    try {
      if (Object.keys(req.body || {}).some(key => key !== "url")) throw new ScrapeError("Only a product URL is accepted", 400);
      const settings = await getProviderSettings(pool);
      const { url, llm } = validateScrapeInput({url:req.body?.url, llm:{...getProviderCredentials(), modelName:settings.modelName}});
      const hostname = new URL(url).hostname.toLowerCase();
      let selectorRule: typeof siteSelectors.$inferSelect | undefined;
      if (db) {
        try {
          selectorRule = (await db.select().from(siteSelectors))
            .filter(rule => rule.enabled && matchesWebsite(hostname, rule.website))
            .sort((a, b) => normalizeWebsite(b.website).length - normalizeWebsite(a.website).length)[0];
        } catch {
          throw new ScrapeError("Failed to load site selector rules", 503);
        }
      }
      const markdown = await scrapeWithAgent(url, llm, selectorRule, controller.signal);
      if (!res.destroyed) res.json({ markdown });
    } catch (error) {
      if (!res.destroyed) res.status(error instanceof ScrapeError ? error.status : 500).json({
        error: error instanceof ScrapeError ? error.message : "Failed to scrape URL",
        details: "Use SAP or manually supplied source content if this page cannot be retrieved.",
      });
    } finally {
      res.removeListener("close", disconnect);
    }
  });

  app.use('/api', (_req,res) => { res.status(404).json({error:'Endpoint not found'}); });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = error instanceof ApiError || error instanceof ProviderError;
    const duplicate = error.code === '23505' || error.cause?.code === '23505';
    const status = known ? error.status : duplicate ? 409 : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 503;
    res.status(status).json({error: known ? error.message : duplicate ? 'A record with this identifier already exists' : status === 400 ? 'Invalid JSON payload' : status === 413 ? 'Request is too large' : 'The operation could not be saved. Please retry.'});
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
    const distPath = path.join(process.cwd(), 'dist', 'public');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const listener = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  const stopWorker = startJobWorker(pool);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    listener.close();
    await stopWorker();
    await pool.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

startServer().catch(error => {
  console.error("Startup failed; API and worker remain unavailable:", error.message);
  void pool?.end().finally(() => { process.exitCode = 1; });
});
