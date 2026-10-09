import express from "express";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { pool, db } from "./src/db/index.js";
import { initializeQaConfiguration, registerQaConfigurationRoutes } from "./src/db/qaConfiguration.js";
import { ProviderError } from "./src/lib/chatCompletion.js";
import { initializeDatabase, verifySchema } from "./src/server/database.js";
import { ApiError, registerCatalogRoutes } from "./src/server/catalog.js";
import { initializeAuth, registerAuth } from "./src/server/auth.js";
import { initializeProvider, registerProviderRoutes, getProviderSettings } from "./src/server/provider.js";
import { collectProductPage } from "./src/server/scrapePipeline.js";
import { initializeJobRuns, registerJobRunRoutes, startJobWorker } from "./src/server/jobRunner.js";
import { registerScrapeRoutes } from "./src/server/scraper.js";

async function startServer() {
  if (!pool || !db) throw new Error("DATABASE_URL is required");
  await initializeDatabase(pool);
  await initializeQaConfiguration(db);
  await initializeAuth(pool);
  await initializeProvider(pool);
  await initializeJobRuns(pool);
  await verifySchema(pool);
  const app = express();
  const listener = createHttpServer(app);
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
  registerScrapeRoutes(app, async (url, signal) => collectProductPage(url, signal, await getProviderSettings(pool)));
  registerProviderRoutes(app,pool);
  registerJobRunRoutes(app,pool);
  app.use('/api', (_req,res) => { res.status(404).json({error:'Endpoint not found'}); });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = error instanceof ApiError || error instanceof ProviderError;
    const duplicate = error.code === '23505' || error.cause?.code === '23505';
    const status = known ? error.status : duplicate ? 409 : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 503;
    res.status(status).json({error: known ? error.message : duplicate ? 'A record with this identifier already exists' : status === 400 ? 'Invalid JSON payload' : status === 413 ? 'Request is too large' : 'The operation could not be saved. Please retry.'});
  });

  // Vite middleware for development
  let vite: ViteDevServer | undefined;
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: listener },
        ws: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
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

  listener.listen(PORT, process.env.HOST || "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  const stopWorker = startJobWorker(pool);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    listener.close();
    await stopWorker();
    await vite?.close();
    await pool.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

startServer().catch(error => {
  console.error("Startup failed; API and worker remain unavailable:", error.message);
  void pool?.end().finally(() => { process.exitCode = 1; });
});
