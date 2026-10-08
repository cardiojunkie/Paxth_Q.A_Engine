import type { Express } from 'express';
import { collectPage, ScrapeError, validateScrapeInput } from '../lib/browserScrape';

export function registerScrapeRoutes(app: Express, collect = collectPage) {
  app.post('/api/scrape/preview', async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'url')) {
        throw new ScrapeError('Only a URL is accepted.', 400, 'INVALID_INPUT');
      }
      const { url } = validateScrapeInput(req.body);
      const result = await collect(url, controller.signal);
      controller.signal.throwIfAborted();
      if (!res.destroyed) res.json(result);
    } catch (error) {
      if (!res.destroyed) res.status(error instanceof ScrapeError ? error.status : controller.signal.aborted ? 499 : 503).json({
        error: error instanceof ScrapeError ? error.message : controller.signal.aborted ? 'URL retrieval was cancelled.' : 'The browser service could not complete retrieval.',
        code: error instanceof ScrapeError ? error.code : controller.signal.aborted ? 'CANCELLED' : 'RETRIEVAL_FAILED',
        ...(error instanceof ScrapeError && error.report ? { report: error.report } : {}),
      });
    } finally { res.removeListener('close', disconnect); }
  });
}
