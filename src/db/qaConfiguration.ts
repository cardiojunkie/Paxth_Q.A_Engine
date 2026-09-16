import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { attributeSets, qaAgentSettings } from "./schema";
import { DEFAULT_QA_AGENT_MEMORY } from "../lib/qaAgent";

const DEFAULT_SETS = [
  "TestSet", "WarrantySet", "Grocery Single Pack", "Grocery Multi Pack", "H&L-C&D-Cookware",
  "H&L-C&D-Serveware", "H&L-C&D-Bakeware", "H&L-C&D-Containers", "H&L-Outdoor & Accessories",
  "HA-WP&D-Accessories", "HH-CE-Brushes, Mops & Buckets", "HH-LE-Laundary Accessories",
  "HH-HE-Car Accessories", "HH-HE-Plastic Storage and Buckets", "E-HM-Weighing scales",
  "HH-EA-Light & Bulbs", "HH-EA-Plug & Extenstion", "HH-EA-Power tools", "H&L-Luggage",
  "H&L-HF-Living Room", "H&L-HF-Bed Room", "H&L-HF-Sofas & Furnitures", "H&L-HF-Cordless Phones",
  "H&L-HF-Seasonal Decor", "H&B-Eyexpress-Sunglasses", "H&L-HF-Bath Furnishing",
  "H&L-HF-Table Linen & Curtains", "H&L-HF-Mattress", "H&L-HF-Floor Covering", "H&L-Toys",
  "H&L-Toys-E-Bikes", "H&L-Toys-Play Ground & Inflated Games", "H&L-S&F-O&G-Team Sports",
  "H&L-S&F-I&D-Racket Sports", "H&L-S&F-Swimming Pool & Accessories",
  "H&L-S&F-OG-TS-Golf Accessories", "H&L-S&F-OG-TS-Skating", "H&L-S&F-OG-Trampoline",
  "H&L-S&F-OG-Other Games & Accessories", "H&L-S&F-E&F-EM-Home GYM", "H&L-S&F-E&F-EM-Tread Mills",
  "H&L-S&F-E&F-EM-Cross Trainer", "H&L-S&F-E&F-EM-Magnetic Upright Bike",
  "H&L-S&F-E&F-EM-Spinning Bike", "H&L-S&F-E&F-Gym And Workout Equipments",
  "H&L-S&F-E&F-Support Equipments", "H&L-S&F-E&F-Fitness Accessories",
  "H&L-S&F-E&F-Strength Training Equipments", "H&L-S&F-E&F-Bicycle & Accessories",
  "H&L-S&F-E&F-B&A-E-Bikes", "H&L-Baby Accessories", "H&B-Perfumes", "H&B-Make Up",
  "H&B-Skin Care", "H&L-Stationery-Pen & Pencil", "H&L-Stationery-Office Supplies",
  "H&L-Stationery-Art & Craft", "H&L-Stationery-School Stationery", "H&L-Stationery-School Bags",
  "H&L-Stationery-Calculators", "H&L-Stationery-Lunch Box & Water Bottle",
  "H&L-Stationery-General Stationery", "H&L-Books", "Electrics-Kitchen Appliances",
  "Elec-HA-Vacuum Cleaners", "Elec-HA-Vacuum Cleaner Accessories", "Elec-HA-Vacuum Cleaning Liquid",
  "Elec-HA-Robotic Vacuum Cleaner", "Elec-HA-Pressure Washers", "Elec-HA-Sewing Machines",
  "Elec-HA-Irons", "Elec-HA-Garment Steamers", "Elec-HA-Heaters", "Elec-HA-Air Purifiers",
  "Elec-HA-Disinfectant Equipment", "Elec-HA-Air Purifier Filters", "Elec-HA-Water Coolers/Dispensers",
  "Elec-HA-Water Filters & Accessories", "Elec-HA-Fans", "Elec-HA-Insect Killers",
  "Elec-LA-Washing Machines", "Elec-LA-Air Conditioners", "Elec-LA-Dishwashers",
  "Elec-LA-Refrigerators", "Elec-LA-Cooking Ranges", "Elec-LA-Cooker Hoods", "Elec-LA-Cooking Hobs",
  "Combo Offers", "Elec-M&W-Smartphones & Tablets",
  "Elec-M&W-MA-Power Adapters / Chargers & Utility Cables", "Elec-M&W-MA-Mobile Cases & Skins",
  "Elec-M&W-MA-Power Banks", "Elec-M&W-MA-Screen Protectors", "Elec-M&W-MA-Stands & Other Accessories",
  "Elec-M&W-W-Smartwatches & Fitness Trackers", "Elec-M&W-W-Wearable Accessories", "Elec-C&A-Desktops",
  "Elec-C&A-Laptops", "Elec-C&A-T&A-Styllus", "Elec-C&A-PCACC-PC Monitors & Projectors",
  "Elec-C&A-PCACC-PC Keyboards & Mouse", "Elec-C&A-PCACC-PC Headsets & Speakers",
  "Elec-C&A-PCACC-Web camera", "Elec-C&A-PCACC-External Storages", "Elec-C&A-PCACC-USB Hubs",
  "Elec-C&A-PCACC-Memory Card Adapters", "Elec-C&A-PCACC-Laptop Stand & Mouse Pad",
  "Elec-C&A-PCACC-Other PC Accessories", "Elec-ITACC-Printers, Scanners & Accessories",
  "Elec-ITACC-Routers & Wi-Fi Range Extenders", "Elec-ITACC-Smart Devices & Accessories",
  "Elec-ITACC-Softwares", "Elec-ITACC-Other IT Accessories", "Elec-Gaming-Consoles",
  "Elec-Gaming-Titles", "Elec-Gaming-VR Headsets", "Elec-Gaming-GA-Controllers",
  "Elec-Gaming-GA-Gaming Chairs & Desks", "Electronics-e-Gift Cards", "Electronics-TV",
  "Elec-Audio-Soundbars&Speakers", "Elec-Audio-Musical Instruments", "Elec-Audio-Radio",
  "Elec-Audio-Receiver", "Elec-Audio-Headphones", "Elec-Audio-Audio Accessories",
  "Elec-PC-Shavers & Trimmers", "Elec-PC-Epilators & IPL Hair Remover", "Elec-PC-Hair Dryers",
  "Elec-PC-Hair Stylers", "Elec-PC-Electric Toothbrush", "Elec-PC-Other Accessories",
  "Electronic-Camera", "Electronics-Medical Equipment", "Bag Attribute Set", "Lulu Gift Card",
  "Grocery Fish&Meat Multi Pack", "Elec-Gaming-GA-Gaming-Accessories"
];

export async function initializeQaConfiguration(db: NodePgDatabase<typeof import("./schema")>) {
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS qa_agent_settings (
      id TEXT PRIMARY KEY, memory TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS attribute_sets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, rules_markdown TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS attribute_sets_normalized_name_idx ON attribute_sets (lower(btrim(name)))`);
    const inserted = await tx.insert(qaAgentSettings).values({ id: "default", memory: DEFAULT_QA_AGENT_MEMORY })
      .onConflictDoNothing().returning();
    // Seed category names only on first setup; deleted sets stay deleted after restarts.
    if (inserted.length) {
      await tx.insert(attributeSets).values(DEFAULT_SETS.map(name => ({ id: randomUUID(), name, rulesMarkdown: "" })))
        .onConflictDoNothing();
    }
  });
}

const mapSet = (set: typeof attributeSets.$inferSelect) => ({
  ...set, createdAt: set.createdAt.getTime(), updatedAt: set.updatedAt.getTime(),
});
const validSet = (value: any) => typeof value?.name === "string" && Boolean(value.name.trim()) && typeof value.rulesMarkdown === "string";

export function registerQaConfigurationRoutes(app: Express, db: NodePgDatabase<typeof import("./schema")> | null) {
  app.get("/api/qa-configuration", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      const configuration = await db.transaction(async tx => {
        const [memory] = await tx.select().from(qaAgentSettings).where(eq(qaAgentSettings.id, "default"));
        if (!memory) throw new Error("QA memory has not been initialized");
        const sets = await tx.select().from(attributeSets).orderBy(attributeSets.name);
        return { qaAgentMemory: memory.memory, attributeSets: sets.map(mapSet) };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
      res.json(configuration);
    } catch {
      res.status(503).json({ error: "Could not load shared QA configuration from the database" });
    }
  });

  app.put("/api/qa-agent-memory", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    if (typeof req.body?.qaAgentMemory !== "string") return res.status(400).json({ error: "qaAgentMemory must be text" });
    const memory = req.body.qaAgentMemory.trim() ? req.body.qaAgentMemory : DEFAULT_QA_AGENT_MEMORY;
    try {
      const [saved] = await db.insert(qaAgentSettings).values({ id: "default", memory })
        .onConflictDoUpdate({ target: qaAgentSettings.id, set: { memory, updatedAt: new Date() } }).returning();
      res.json({ qaAgentMemory: saved.memory });
    } catch {
      res.status(503).json({ error: "QA agent memory could not be saved" });
    }
  });

  app.post("/api/attribute-sets/import", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    if (!Array.isArray(req.body) || !req.body.every(validSet)) return res.status(400).json({ error: "Expected attribute sets with names and text mapping rules" });
    try {
      const imported = await db.transaction(async tx => {
        let count = 0;
        for (const item of req.body) {
          if (!item.rulesMarkdown.trim()) continue;
          const name = item.name.trim();
          const [existing] = await tx.select().from(attributeSets).where(sql`lower(btrim(${attributeSets.name})) = ${name.toLowerCase()}`);
          const saved = existing
            ? await tx.update(attributeSets).set({ rulesMarkdown: item.rulesMarkdown, updatedAt: new Date() })
                .where(and(eq(attributeSets.id, existing.id), sql`${attributeSets.rulesMarkdown} ~ '^[[:space:]]*$'`)).returning()
            : await tx.insert(attributeSets).values({ id: randomUUID(), name, rulesMarkdown: item.rulesMarkdown }).onConflictDoNothing().returning();
          count += saved.length;
        }
        return count;
      });
      res.json({ imported });
    } catch {
      res.status(503).json({ error: "Browser mapping rules could not be imported" });
    }
  });

  app.post("/api/attribute-sets", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    if (!validSet(req.body)) return res.status(400).json({ error: "A name and text mapping rules are required" });
    try {
      const [saved] = await db.insert(attributeSets).values({
        id: randomUUID(), name: req.body.name.trim(), rulesMarkdown: req.body.rulesMarkdown,
      }).onConflictDoNothing().returning();
      if (!saved) return res.status(409).json({ error: "An attribute set with this name already exists" });
      res.status(201).json(mapSet(saved));
    } catch {
      res.status(503).json({ error: "Attribute set could not be saved" });
    }
  });

  app.put("/api/attribute-sets/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    if (!validSet(req.body)) return res.status(400).json({ error: "A name and text mapping rules are required" });
    try {
      const [saved] = await db.update(attributeSets).set({
        name: req.body.name.trim(), rulesMarkdown: req.body.rulesMarkdown, updatedAt: new Date(),
      }).where(eq(attributeSets.id, req.params.id)).returning();
      if (!saved) return res.status(404).json({ error: "Attribute set no longer exists. Reload the list." });
      res.json(mapSet(saved));
    } catch (error: any) {
      if (error.code === "23505" || error.cause?.code === "23505") return res.status(409).json({ error: "An attribute set with this name already exists" });
      res.status(503).json({ error: "Attribute set could not be updated" });
    }
  });

  app.delete("/api/attribute-sets/:id", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB not connected" });
    try {
      await db.delete(attributeSets).where(eq(attributeSets.id, req.params.id));
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: "Attribute set could not be deleted" });
    }
  });
}
