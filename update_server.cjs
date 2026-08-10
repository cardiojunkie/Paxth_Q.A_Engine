const fs = require('fs');

const serverFile = 'server.ts';
let content = fs.readFileSync(serverFile, 'utf-8');

const endpoints = `
  import { eq, inArray } from "drizzle-orm";
  import { attributeSets, jobs, skuData } from "./src/db/schema.js";

  // --- SKU Data Endpoints ---
  app.get("/api/catalog", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const data = await db.select().from(skuData);
      // Map back to frontend expected format (camelCase to snake_case if needed, but schema uses camelCase for db keys but they might be selected as is. wait, drizzle selects what is defined in schema.ts)
      const mapped = data.map(row => ({
        sku: row.sku,
        upload_attributes: row.uploadAttributes,
        source: row.source,
        raw_row: row.rawRow,
        status: row.status,
        attribute_set: row.attributeSetId,
        scraped_markdown: row.scrapedMarkdown,
        scrape_status: row.scrapeStatus,
        tokensUsed: row.tokensUsed,
        timeTaken: row.timeTaken,
        error: row.error
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
        attributeSetId: item.attribute_set || null,
        scrapedMarkdown: item.scraped_markdown || null,
        scrapeStatus: item.scrape_status || null,
        tokensUsed: item.tokensUsed || null,
        timeTaken: item.timeTaken || null,
        error: item.error || null
      }));
      
      // Upsert using onConflictDoUpdate
      for (const item of toInsert) {
        await db.insert(skuData).values(item).onConflictDoUpdate({
          target: skuData.sku,
          set: item
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
      const toUpdate = {
        uploadAttributes: item.upload_attributes,
        source: item.source,
        rawRow: item.raw_row,
        status: item.status,
        attributeSetId: item.attribute_set || null,
        scrapedMarkdown: item.scraped_markdown || null,
        scrapeStatus: item.scrape_status || null,
        tokensUsed: item.tokensUsed || null,
        timeTaken: item.timeTaken || null,
        error: item.error || null
      };
      
      // Remove undefined keys
      Object.keys(toUpdate).forEach(key => toUpdate[key] === undefined && delete toUpdate[key]);

      await db.update(skuData).set(toUpdate).where(eq(skuData.sku, sku));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/catalog", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const { skus } = req.body;
      if (skus && skus.length > 0) {
        await db.delete(skuData).where(inArray(skuData.sku, skus));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
`;

if (!content.includes('app.get("/api/catalog"')) {
  content = content.replace('// Scraping endpoint', endpoints + '\n  // Scraping endpoint');
  content = content.replace('import { skuData } from "./src/db/schema.js";', 'import { skuData, attributeSets, jobs } from "./src/db/schema.js";\nimport { eq, inArray } from "drizzle-orm";');
  fs.writeFileSync(serverFile, content);
  console.log("Endpoints added");
} else {
  console.log("Endpoints already exist");
}
