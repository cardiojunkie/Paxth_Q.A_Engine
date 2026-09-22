import assert from "node:assert/strict";
import { createServer } from "vite";
import type { SkuData } from "../hooks/useCatalogData";
import {DEFAULT_SETTINGS} from "../lib/providerSettings";
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
  sku("present", { status: "completed", scrape_status: "success", scraped_markdown: "Web evidence", qa_result: { summary: "Previous QA" }, export_data: { summary: "Previous export" } }),
  sku("present-failed", { scrape_status: "failed", scraped_markdown: "Web evidence" }),
  sku("present-pending", { scraped_markdown: "Web evidence" }),
  sku("manual/9 #?", { status: "cannot_qa", source: { fileName: "catalog.xlsx", headerOrder: ["sku"] } }),
];
catalog[0].source.sap = "Existing SAP";
catalog[0].status = "completed";
catalog[0].qa_result = { summary: "Previous QA" };
catalog[0].export_data = { summary: "Previous export" };
catalog[5].source.sap = "Keep existing SAP";
const original = structuredClone(catalog);
const writes: { sku: string; updates: Partial<SkuData> }[] = [];
let failure: "http" | "network" | undefined;
let holdSave = false;
let releaseSave!: () => void;
let saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
let holdScrape = false;
let releaseScrape!: () => void;
const scrapeGate = new Promise<void>(resolve => { releaseScrape = resolve; });
let scrapeRequests = 0;
const chatRequests: any[] = [];
let sampleResponse: any;
const jobs = [{ id: "scrape-check", name: "Scrape integration", status: "pending", skus: ["present-pending"], created_at: new Date().toISOString(), attribute_set: "TV" }];

process.env.CLOAKBROWSER_AUTO_UPDATE = "false";
const { launch } = await import("cloakbrowser");
const { chromium } = await import("playwright-core");
const server = await createServer({ cacheDir:"/tmp/paxth-vite-browser-cache", server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
try {
  await server.listen();
  browser = process.env.CHROMIUM_EXECUTABLE ? await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:["--no-sandbox"]}) : await launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    localStorage.setItem("paxth_qa_user_session", JSON.stringify({
      username: "SAP browser check", role: "user", loginTime: new Date().toISOString(),
    }));
    localStorage.setItem("qa-analyzer-settings", JSON.stringify({
      baseUrl: "https://aicredits.in/v1", apiKey: "test-only", modelName: "test-model",
      temperature: 0.3, maxTokens: 10000, maxConcurrency: 3, maxRetries: 2,
    }));
  });
  let authenticated=false;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const account={id:'browser-admin',username:'Browser test admin',role:'admin',loginTime:new Date().toISOString()};
    if(path==='/api/auth/me')return route.fulfill({status:authenticated?200:401,json:authenticated?account:{error:'Sign in'}});
    if(path==='/api/auth/login'){authenticated=true;return route.fulfill({json:account});}
    if(path==='/api/users')return route.fulfill({json:[]});
    if(path==='/api/provider-settings')return route.fulfill({json:{...DEFAULT_SETTINGS,providerConfigured:true}});
    if(path==='/api/jobs/scrape-check/runs')return route.fulfill({json:[]});
    if (path === "/api/scrape") {
      scrapeRequests++;
      assert.ok(holdScrape, "Editing source data must not trigger a scrape");
      assert.deepEqual(Object.keys(request.postDataJSON()), ["url"]);
      await scrapeGate;
      return route.fulfill({ json: { markdown: "Automatically scraped content" } });
    }
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
      return route.fulfill({ json: item });
    }
    if (path === "/api/catalog") return route.fulfill({ json: catalog });
    if (path === "/api/jobs") return route.fulfill({ json: jobs });
    if (path === "/api/jobs/scrape-check") return route.fulfill({ json: { success: true } });
    if (path === "/api/site-selectors") return route.fulfill({ json: [] });
    if (path === "/api/qa-configuration") return route.fulfill({ json: { qaAgentMemory: "Use supplied evidence.", attributeSets: [] } });
    if (path === "/api/chat") {
      chatRequests.push(request.postDataJSON());
      return route.fulfill({json:{success:true}});
    }
    if (path === "/api/db-status") return route.fulfill({ json: { status: "connected" } });
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });

  await page.goto(server.resolvedUrls!.local[0]);
  await page.getByRole('button',{name:'Sign In to Engine',exact:true}).waitFor();
  assert.equal(authenticated,false,'Forged localStorage account cannot authenticate');
  await page.getByLabel('Username',{exact:true}).fill('browser-admin');
  await page.getByLabel('Password',{exact:true}).fill('browser-test-password');
  await page.getByRole('button',{name:'Sign In to Engine',exact:true}).click();
  const row = (id: string) => page.getByRole("row", { includeHidden: true }).filter({ has: page.getByRole("cell", { name: id, exact: true, includeHidden: true }) });
  await row("pending").waitFor();
  assert.equal(await page.getByRole("columnheader").nth(4).textContent(), "SAP Available");
  assert.equal(await page.getByRole("columnheader").nth(6).textContent(), "Scraped Data");
  for (const item of catalog) {
    const cells = row(item.sku).getByRole("cell");
    assert.equal(await cells.nth(4).getByRole("button", { name: "View/Edit SAP", exact: true }).count(), 1);
    assert.equal(await cells.nth(6).getByRole("button", { name: "View/Edit Data", exact: true }).count(), 1);
    assert.equal(await cells.nth(6).getByRole("button", { name: /SAP/ }).count(), 0);
  }
  assert.match(await row("pending").innerText(), /Pending/);
  assert.match(await row("failed").innerText(), /Failed/);

  const dialog = page.getByRole("dialog");
  const text = dialog.getByLabel("SAP source text", { exact: true });
  const save = dialog.getByRole("button", { name: "Save SAP", exact: true });
  const edit = async (id: string) => {
    await row(id).getByRole("button", { name: "View/Edit SAP", exact: true }).click();
    await text.waitFor();
  };

  await edit("pending");
  assert.equal(await text.inputValue(), "Existing SAP");
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  assert.equal(await save.count(), 1);
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

  await edit("present");
  assert.equal(await text.inputValue(), "Keep existing SAP", "SAP remains editable when scraped data exists");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

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
  assert.deepEqual(catalog[2], original[2], "Do not change saved data before confirmation");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(writes.length, 1, "Only one save request may be in flight");
  releaseSave();
  holdSave = false;
  await dialog.waitFor({ state: "hidden" });
  await row("missing/2 #?").getByRole("button", { name: "View/Edit SAP" }).waitFor();
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

  const content = dialog.getByLabel("Product content (plain text or Markdown)", { exact: true });
  const saveData = dialog.getByRole("button", { name: "Save Data", exact: true });
  const editData = async (id: string) => {
    await row(id).getByRole("button", { name: "View/Edit Data", exact: true }).click();
    await content.waitFor();
  };

  for (const item of catalog) {
    await editData(item.sku);
    assert.equal(await content.inputValue(), item.scraped_markdown || "");
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    await content.fill("Discard this product draft");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  const writesBeforeData = writes.length;
  await editData("present");
  assert.equal(await content.inputValue(), "Web evidence");
  await content.fill("Cancel this draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await editData("present");
  assert.equal(await content.inputValue(), "Web evidence");
  await dialog.getByRole("button", { name: "Close scraped data" }).click();
  assert.equal(writes.length, writesBeforeData, "Closing an editor must not save its draft");

  const pastedContent = "# Product details\nModel: A1\nColour: black";
  await editData("manual/9 #?");
  assert.equal(await content.inputValue(), "");
  await content.fill(pastedContent);
  saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  holdSave = true;
  await Promise.all([page.waitForRequest(request => request.method() === "PUT"), saveData.click()]);
  await saving.waitFor();
  assert.equal(await saving.isDisabled(), true);
  assert.equal(await content.isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "Close scraped data" }).isDisabled(), true);
  assert.deepEqual(catalog[8], original[8], "Do not show pasted data as saved before confirmation");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(writes.length, writesBeforeData + 1, "Only one content save may be in flight");
  releaseSave();
  holdSave = false;
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(catalog[8], { ...original[8], status: "ready", scraped_markdown: pastedContent, scrape_status: "success" });
  const manualQa = prepareQaInput(catalog[8], [], "Check supplied sources", 40000);
  assert.equal(manualQa.sapAvailable, false);
  assert.equal(manualQa.webAvailable, true);
  assert.equal(JSON.parse(manualQa.messages[1].content).scraped_markdown, pastedContent);
  assert.equal(JSON.parse(manualQa.messages[1].content).source_url, "");

  await editData("present");
  const editedContent = "Edited product content\nCapacity: 20 L";
  await content.fill(editedContent);
  await saveData.click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(catalog[5], { ...original[5], scraped_markdown: editedContent }, "Editing preserves SAP, uploaded data, status, and previous QA results");

  await page.reload();
  for (const [id, expected] of [["manual/9 #?", pastedContent], ["present", editedContent]]) {
    await editData(id);
    assert.equal(await content.inputValue(), expected, "Product content persists through reload");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }

  for (const mode of ["http", "network"] as const) {
    failure = mode;
    await editData("present-failed");
    await content.fill(`Keep this ${mode} content draft`);
    await saveData.click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await content.inputValue(), `Keep this ${mode} content draft`);
    assert.equal(await saveData.isEnabled(), true);
    assert.deepEqual(catalog[6], original[6]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await editData("present-failed");
    assert.equal(await content.inputValue(), "Web evidence", "Failed saves must preserve local content");
    assert.equal(await dialog.getByRole("alert").count(), 0, "Reopening clears the previous save error");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  failure = undefined;
  await editData("present-failed");
  await content.fill("Retried product content");
  await saveData.click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(catalog[6], { ...original[6], scraped_markdown: "Retried product content", scrape_status: "success" });

  for (const blank of ["", " \n "]) {
    await editData("present");
    await content.fill(blank);
    assert.equal(await saveData.isEnabled(), true);
    await saveData.click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(catalog[5], { ...original[5], scraped_markdown: blank, scrape_status: "failed" }, "Clearing content keeps existing QA results");
  }

  holdScrape = true;
  saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  holdSave = true;
  await row("empty").getByRole("cell").first().click();
  await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname === "/api/scrape"),
    page.getByRole("button", { name: "Scrape URLs (1)", exact: true }).click(),
  ]);
  for (const item of catalog) {
    assert.equal(await row(item.sku).getByRole("button", { name: "View/Edit Data", exact: true }).isDisabled(), true);
  }
  const scrapeSaveStarted = page.waitForRequest(request => request.method() === "PUT");
  releaseScrape();
  await scrapeSaveStarted;
  assert.equal(await page.getByRole("button", { name: "Scraping...", exact: true }).isVisible(), true);
  assert.equal(await row("empty").getByRole("button", { name: "View/Edit Data", exact: true }).isDisabled(), true, "Keep editing disabled until the scrape is saved");
  releaseSave();
  holdSave = false;
  await page.getByRole("button", { name: "Scrape URLs (1)", exact: true }).waitFor();
  assert.equal(await row("empty").getByRole("button", { name: "View/Edit Data", exact: true }).isEnabled(), true);
  await editData("empty");
  assert.equal(await content.inputValue(), "Automatically scraped content");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Scraper", exact: true }).click();
  await page.getByPlaceholder("https://example.com/product/...").fill("https://example.com/product");
  await page.getByRole("button", { name: "Scrape URL", exact: true }).click();
  await page.getByText("Automatically scraped content", { exact: true }).waitFor();
  assert.equal(scrapeRequests,2,'Browser scrape callers send only URLs');
  await page.getByRole('button',{name:'LLM Settings',exact:true}).click();
  await page.getByRole('button',{name:'Test saved settings',exact:true}).click();
  await page.getByText('Saved settings passed the QA response check.',{exact:true}).waitFor();
  assert.deepEqual(chatRequests,[{}],'Admin test uses server settings without client credentials');
  assert.equal(await page.getByLabel('API Key',{exact:true}).count(),0);
  console.log('Browser checks passed: forged-session rejection, confirmed saves, preserved drafts, and credential-free requests.');
} finally {
  releaseSave();
  releaseScrape();
  await browser?.close();
  await server.close();
}
