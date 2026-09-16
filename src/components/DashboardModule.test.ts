import assert from "node:assert/strict";
import { createServer } from "vite";
import type { SkuData } from "../hooks/useCatalogData";
import { prepareQaInput } from "../lib/qaAgent";

const sku = (id: string, updates: Partial<SkuData> = {}): SkuData => ({
  sku: id, status: "ready", attribute_set: "TV", upload_attributes: {},
  source: { url: "https://example.com/product", fileName: "catalog.xlsx", headerOrder: ["sku", "source__sap"] },
  raw_row: { sku: id, source__sap: "Original upload" },
  ...updates,
});
const catalog = [
  sku("pending"),
  sku("failed", { scrape_status: "failed" }),
  sku("missing/2 #?", { status: "cannot_qa", scrape_status: "skipped_no_url", source: { fileName: "catalog.xlsx", headerOrder: ["sku"] } }),
  sku("empty", { scrape_status: "success", scraped_markdown: "" }),
  sku("whitespace", { scrape_status: "success", scraped_markdown: " \n " }),
  sku("present", { scrape_status: "success", scraped_markdown: "Web evidence" }),
  sku("present-failed", { scrape_status: "failed", scraped_markdown: "Web evidence" }),
  sku("present-pending", { scraped_markdown: "Web evidence" }),
];
catalog[0].source.sap = "Existing SAP";
catalog[0].status = "completed";
catalog[0].qa_result = { summary: "Previous QA" };
catalog[0].export_data = { summary: "Previous export" };
const original = structuredClone(catalog);
const writes: { sku: string; updates: Partial<SkuData> }[] = [];
let failure: "http" | "network" | undefined;
let holdSave = false;
let releaseSave!: () => void;
const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });

process.env.CLOAKBROWSER_AUTO_UPDATE = "false";
const { launch } = await import("cloakbrowser");
const server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
try {
  await server.listen();
  browser = await launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => localStorage.setItem("paxth_qa_user_session", JSON.stringify({
    username: "SAP browser check", role: "user", loginTime: new Date().toISOString(),
  })));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT" && path.startsWith("/api/catalog/")) {
      const id = decodeURIComponent(path.slice("/api/catalog/".length));
      const updates = request.postDataJSON() as Partial<SkuData>;
      writes.push({ sku: id, updates });
      if (holdSave) await saveGate;
      if (failure === "network") return route.abort("failed");
      if (failure === "http") return route.fulfill({ status: 503, json: { error: "Database unavailable" } });
      const item = catalog.find(item => item.sku === id);
      assert.ok(item, `Unexpected SKU ${id}`);
      Object.assign(item, updates);
      return route.fulfill({ json: { success: true } });
    }
    if (path === "/api/catalog") return route.fulfill({ json: catalog });
    if (path === "/api/jobs") return route.fulfill({ json: [] });
    if (path === "/api/db-status") return route.fulfill({ json: { status: "connected" } });
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });

  await page.goto(server.resolvedUrls!.local[0]);
  const row = (id: string) => page.getByRole("row", { includeHidden: true }).filter({ has: page.getByRole("cell", { name: id, exact: true, includeHidden: true }) });
  await row("pending").waitFor();
  for (const item of catalog) {
    assert.equal(await row(item.sku).getByRole("button", { name: "Edit SAP", exact: true }).count(), item.scraped_markdown?.trim() ? 0 : 1);
  }
  assert.match(await row("pending").innerText(), /Pending/);
  assert.match(await row("failed").innerText(), /Failed/);

  const dialog = page.getByRole("dialog");
  const text = dialog.getByLabel("SAP source text", { exact: true });
  const save = dialog.getByRole("button", { name: "Save SAP", exact: true });
  const edit = async (id: string) => {
    await row(id).getByRole("button", { name: "Edit SAP", exact: true }).click();
    await text.waitFor();
  };

  await row("pending").getByRole("button", { name: "View SAP" }).click();
  await dialog.waitFor();
  assert.equal(await dialog.locator("textarea").count(), 0);
  assert.equal(await save.count(), 0);
  assert.match(await dialog.innerText(), /Existing SAP/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  await edit("pending");
  assert.equal(await text.inputValue(), "Existing SAP");
  await text.fill("Discard this draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(writes.length, 0);
  await edit("pending");
  assert.equal(await text.inputValue(), "Existing SAP");
  await dialog.getByRole("button", { name: "Close SAP" }).click();

  await edit("missing/2 #?");
  assert.equal(await text.inputValue(), "");
  assert.equal(await save.isDisabled(), true);
  await text.fill(" \n ");
  assert.equal(await save.isDisabled(), true);
  assert.equal(writes.length, 0);
  const addedSap = "Model: A1\nColour: black";
  await text.fill(addedSap);
  holdSave = true;
  await Promise.all([page.waitForRequest(request => request.method() === "PUT"), save.click()]);
  const saving = dialog.getByRole("button", { name: "Saving...", exact: true });
  await saving.waitFor();
  assert.equal(await saving.isDisabled(), true);
  assert.equal(await text.isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.equal(await row("missing/2 #?").getByRole("button", { name: "View SAP", includeHidden: true }).count(), 0);
  assert.deepEqual(catalog[2], original[2], "Do not change saved data before confirmation");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(writes.length, 1, "Only one save request may be in flight");
  releaseSave();
  holdSave = false;
  await dialog.waitFor({ state: "hidden" });
  await row("missing/2 #?").getByRole("button", { name: "View SAP" }).waitFor();
  assert.deepEqual(catalog[2], { ...original[2], status: "ready", source: { ...original[2].source, sap: addedSap } });

  await edit("pending");
  await text.fill("Updated SAP\nCapacity: 20 L");
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(catalog[0], { ...original[0], source: { ...original[0].source, sap: "Updated SAP\nCapacity: 20 L" } });
  assert.deepEqual(Object.keys(writes[1].updates), ["source"], "Keep uploaded rows, previous QA, and scrape status intact");
  const qa = prepareQaInput(catalog[2], [], "Check supplied sources", 40000);
  assert.equal(qa.sapAvailable, true);
  assert.equal(qa.webAvailable, false);
  assert.equal(JSON.parse(qa.messages[1].content).source_sap, addedSap);

  await page.reload();
  await edit("missing/2 #?");
  assert.equal(await text.inputValue(), addedSap, "SAP persists through reload");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  for (const mode of ["http", "network"] as const) {
    failure = mode;
    await edit("failed");
    await text.fill(`Keep this ${mode} draft`);
    await save.click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await text.inputValue(), `Keep this ${mode} draft`);
    assert.equal(await save.isEnabled(), true);
    assert.deepEqual(catalog[1], original[1]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await edit("failed");
    assert.equal(await text.inputValue(), "", "Failed saves must not update local catalog state");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  failure = undefined;
  await edit("failed");
  await text.fill("Retry SAP");
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(catalog[1].source.sap, "Retry SAP");
  assert.equal(catalog[1].scrape_status, "failed");
  console.log("SAP editor browser assertions passed.");
} finally {
  releaseSave();
  await browser?.close();
  await server.close();
}
