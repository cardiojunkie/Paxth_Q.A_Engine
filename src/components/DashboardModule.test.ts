import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import type { ScrapePreview } from '../lib/browserScrape';
import type { SkuData } from "../hooks/useCatalogData";
import { DEFAULT_SETTINGS } from "../lib/providerSettings";
import { prepareQaInput } from "../lib/qaAgent";

const sku = (id: string, updates: Partial<SkuData> = {}): SkuData => ({
  sku: id, revision: 0, status: "ready", attribute_set: "TV", upload_attributes: {},
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
const sameData = (actual: SkuData, expected: SkuData, message?: string) => {
  const {revision: _actual, ...actualData} = actual;
  const {revision: _expected, ...expectedData} = expected;
  assert.deepEqual(actualData, expectedData, message);
};
const writes: { sku: string; updates: Partial<SkuData> }[] = [];
let failure: "http" | "network" | undefined;
let holdSave = false;
let releaseSave!: () => void;
let saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
let holdScrape = false;
let releaseScrape!: () => void;
const scrapeGate = new Promise<void>(resolve => { releaseScrape = resolve; });
let scrapeRequests = 0;
let scrapeMarkdown = 'Automatically scraped content';
let lastScrapeRevision: number;
let scrapeMode: 'success' | 'blocked' | 'wait' = 'success';
let finishScrape: (() => void) | undefined;
let emptyCatalog = false;
let previewMode: 'collected' | 'partial' | 'blocked' | 'failed' | 'wait' = 'collected';
let previewRequests = 0;
let finishPreview: (() => void) | undefined;
let lastPreview: ScrapePreview;
const imageUrl = 'http://127.0.0.1:3219/private-image.svg';
const imageMarkdown = `![Product photo](${imageUrl})`;
const previewMarkdown = `# Preview product\n\nWeight: **500 g**\n\n${imageMarkdown}`;
let imageRequests = 0;
const chatRequests: any[] = [];
const settingsWrites: any[] = [];
const createdJobs: any[] = [];
let savedSettings = { ...DEFAULT_SETTINGS, providerConfigured: true };
let releaseChat!: () => void;
const chatGate = new Promise<void>(resolve => { releaseChat = resolve; });
let chatMode: 'mixed' | 'success' | 'malformed' | 'missing' = 'mixed';
let queuedRun: any;
let failNextCatalogRefresh = false;
let startRunRequests = 0;
let catalogRefreshFailures = 0;
let holdNextCatalogRefresh = false;
let heldCatalogStarted: (() => void) | undefined;
let releaseCatalogRefresh = () => {};
let catalogRefreshGate = Promise.resolve();
let sampleResponse: any;
const jobs = [{ id: "scrape-check", name: "Scrape integration", status: "pending", skus: ["present-pending"], created_at: new Date().toISOString(), attribute_set: "TV" }];

const { chromium } = await import("playwright-core");
const server = await createServer({ cacheDir: "/tmp/paxth-vite-browser-cache", server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.route(imageUrl, route => { imageRequests++; return route.fulfill({status:204}); });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem("paxth_qa_user_session", JSON.stringify({
      username: "SAP browser check", role: "user", loginTime: new Date().toISOString(),
    }));
    localStorage.setItem("qa-analyzer-settings", JSON.stringify({
      baseUrl: "https://aicredits.in/v1", apiKey: "test-only", modelName: "test-model",
      temperature: 0.3, maxTokens: 10000, maxConcurrency: 3, maxRetries: 2,
    }));
  });
  let authenticated = false;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const account = { id: 'browser-admin', username: 'Browser test admin', role: 'admin', loginTime: new Date().toISOString() };
    if (path === '/api/auth/me') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? account : { error: 'Sign in' } });
    if (path === '/api/auth/login') { authenticated = true; return route.fulfill({ json: account }); }
    if (path === '/api/users') return route.fulfill({ json: [] });
    if (path === '/api/provider-settings') {
      if (request.method() === 'PUT') { settingsWrites.push(request.postDataJSON()); savedSettings = { ...savedSettings, ...request.postDataJSON() }; }
      return route.fulfill({ json: savedSettings });
    }
    if (path === '/api/jobs/scrape-check/runs') {
      if (request.method() === 'POST') {
        startRunRequests++;
        assert.equal(request.postDataJSON().mode, 'unfinished');
        assert.ok(request.postDataJSON().requestId);
        queuedRun = { id: 'accepted-browser-run', jobId: 'scrape-check', actorId: account.id, actorName: account.username, mode: 'unfinished', status: 'queued', createdAt: new Date().toISOString(), items: [{ sku: 'present-pending', status: 'queued', attempts: 0, snapshot: catalog[7] }] };
        failNextCatalogRefresh = true;
        return route.fulfill({ status: 202, json: queuedRun });
      }
      return route.fulfill({ json: queuedRun ? [queuedRun] : [] });
    }
    if (path === '/api/job-runs/accepted-browser-run') return route.fulfill({ json: queuedRun });
    if (path === '/api/scrape/preview') {
      previewRequests++;
      assert.equal(request.method(),'POST');
      assert.deepEqual(Object.keys(request.postDataJSON()),['url']);
      const requestedUrl = request.postDataJSON().url;
      const report = { durationMs: 1500, characters: previewMarkdown.length, clicks: 2, scrolls: 3,
        warnings: previewMode === 'partial' ? [{ code: 'UNRESOLVED_CONTROL', message: 'Specifications could not be revealed.' }] : [],
        unresolvedControls: previewMode === 'partial' ? ['Specifications'] : [] };
      if (previewMode === 'blocked' || previewMode === 'failed') return route.fulfill({status:502,json:{error:previewMode === 'blocked' ? 'The website blocked browser access.' : 'The page could not be loaded.',code:previewMode === 'blocked' ? 'PAGE_BLOCKED' : 'NAVIGATION_FAILED',report}});
      if (previewMode === 'wait') {
        await new Promise<void>(resolve=>{finishPreview=resolve;});
        return route.fulfill({json:{status:'collected',markdown:'# Stale preview',requestedUrl,finalUrl:requestedUrl,capturedAt:'2026-10-07T00:00:00Z',report}}).catch(()=>{});
      }
      lastPreview = {status:previewMode,markdown:previewMarkdown,requestedUrl,finalUrl:'https://example.com/final',capturedAt:'2026-10-07T00:00:00Z',report};
      return route.fulfill({json:lastPreview});
    }
    if (request.method() === 'POST' && path.startsWith('/api/catalog/') && path.endsWith('/scrape')) {
      scrapeRequests++;
      assert.ok(holdScrape, 'Editing evidence must not trigger a scrape');
      assert.deepEqual(Object.keys(request.postDataJSON()), ['expectedRevision']);
      const id = decodeURIComponent(path.slice('/api/catalog/'.length, -'/scrape'.length));
      const item = catalog.find(item => item.sku === id)!;
      const expectedRevision = request.postDataJSON().expectedRevision;
      lastScrapeRevision = expectedRevision;
      await scrapeGate;
      if (holdSave) await saveGate;
      if (scrapeMode === 'blocked') {
        item.scrape_error = 'The website blocked browser access.';
        return route.fulfill({status:502,json:{error:item.scrape_error}});
      }
      if (scrapeMode === 'wait') {
        await new Promise<void>(resolve=>{finishScrape=resolve;});
        return route.abort().catch(()=>{});
      }
      if (item.revision !== expectedRevision) return route.fulfill({status:409,json:{error:'SKU changed. Refresh before scraping.'}});
      Object.assign(item, { revision: expectedRevision + 1, scraped_markdown: scrapeMarkdown, scrape_status: 'success', scrape_error: null,
        scrape_metadata: {method:'browser',requestedUrl:item.source.url,finalUrl:item.source.url,capturedAt:'2026-10-07T00:00:00Z'} });
      return route.fulfill({json:item}).catch(()=>{});
    }
    if (request.method() === "PUT" && path.startsWith("/api/catalog/")) {
      const id = decodeURIComponent(path.slice("/api/catalog/".length));
      const {expectedRevision, ...updates} = request.postDataJSON() as Partial<SkuData> & {expectedRevision:number};
      writes.push({ sku: id, updates });
      if (holdSave) await saveGate;
      if (failure === "network") return route.abort("failed");
      if (failure === "http") return route.fulfill({ status: 503, json: { error: "Database unavailable" } });
      const item = catalog.find(item => item.sku === id);
      assert.ok(item, `Unexpected SKU ${id}`);
      if (expectedRevision !== item.revision) return route.fulfill({status:409,json:{error:"SKU changed. Your draft was not saved."}});
      Object.assign(item, updates, {revision:expectedRevision+1});
      return route.fulfill({ json: item });
    }
    if (path === "/api/catalog") {
      if (holdNextCatalogRefresh) {
        holdNextCatalogRefresh = false;
        const olderRows = structuredClone(catalog);
        heldCatalogStarted?.();
        await catalogRefreshGate;
        return route.fulfill({json:olderRows});
      }
      if (failNextCatalogRefresh) { failNextCatalogRefresh = false; catalogRefreshFailures++; return route.fulfill({ status: 503, json: { error: 'Catalog refresh temporarily unavailable' } }); }
      return route.fulfill({ json: emptyCatalog ? [] : catalog });
    }
    if (path === "/api/jobs") {
      if (request.method() === 'POST') { createdJobs.push(...request.postDataJSON()); return route.fulfill({json:request.postDataJSON()}); }
      return route.fulfill({ json: jobs });
    }
    if (path === "/api/jobs/scrape-check") return route.fulfill({ json: { success: true } });
    if (path === "/api/qa-configuration") return route.fulfill({ json: { qaAgentMemory: "Use supplied evidence.", attributeSets: [] } });
    if (path === "/api/chat") {
      chatRequests.push(request.postDataJSON());
      await chatGate;
      if (chatMode === 'missing') return route.fulfill({ status: 503, json: { error: 'Configure LLM_BASE_URL and LLM_API_KEY on the server.' } });
      if (chatMode === 'malformed') return route.fulfill({ json: { success: false } });
      return route.fulfill({ json: { success: true } });
    }
    if (path === "/api/db-status") return route.fulfill({ json: { status: "connected" } });
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });

  await page.goto(server.resolvedUrls!.local[0]);
  await page.getByRole('button', { name: 'Sign In to Engine', exact: true }).waitFor();
  assert.equal(authenticated, false, 'Forged localStorage account cannot authenticate');
  await page.getByLabel('Username', { exact: true }).fill('browser-admin');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign In to Engine', exact: true }).click();
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
  sameData(catalog[2], original[2], "Do not change saved data before confirmation");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(writes.length, 1, "Only one save request may be in flight");
  releaseSave();
  holdSave = false;
  await dialog.waitFor({ state: "hidden" });
  await row("missing/2 #?").getByRole("button", { name: "View/Edit SAP" }).waitFor();
  sameData(catalog[2], { ...original[2], status: "ready", source: { ...original[2].source, sap: addedSap } });

  await edit("pending");
  await text.fill("Updated SAP\nCapacity: 20 L");
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  sameData(catalog[0], { ...original[0], source: { ...original[0].source, sap: "Updated SAP\nCapacity: 20 L" } });
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
    sameData(catalog[1], original[1]);
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
  sameData(catalog[8], original[8], "Do not show pasted data as saved before confirmation");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(writes.length, writesBeforeData + 1, "Only one content save may be in flight");
  releaseSave();
  holdSave = false;
  await dialog.waitFor({ state: "hidden" });
  sameData(catalog[8], { ...original[8], status: "ready", scraped_markdown: pastedContent, scrape_status: "success" });
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
  sameData(catalog[5], { ...original[5], scraped_markdown: editedContent }, "Editing preserves SAP, uploaded data, status, and previous QA results");

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
    sameData(catalog[6], original[6]);
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
  sameData(catalog[6], { ...original[6], scraped_markdown: "Retried product content", scrape_status: "success" });

  for (const blank of ["", " \n "]) {
    await editData("present");
    await content.fill(blank);
    assert.equal(await saveData.isEnabled(), true);
    await saveData.click();
    await dialog.waitFor({ state: "hidden" });
    sameData(catalog[5], { ...original[5], scraped_markdown: blank, scrape_status: "failed" }, "Clearing content keeps existing QA results");
  }

  await editData('present');
  await content.fill('Preserve this conflicted draft');
  catalog[5].revision!++;
  catalog[5].scraped_markdown = 'Saved by another editor';
  await saveData.click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await content.inputValue(),'Preserve this conflicted draft','Conflicts preserve the open draft');
  assert.equal(catalog[5].scraped_markdown,'Saved by another editor','A stale draft must not overwrite new evidence');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await editData('present');
  assert.equal(await content.inputValue(),'Saved by another editor','Conflicts refresh saved catalog state');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();

  await row('empty').getByRole('cell').first().click();
  await page.getByRole('button',{name:'Create QA Job (1)',exact:true}).click();
  assert.equal(createdJobs.length,1,'URL-only SKUs can create a QA job');
  assert.deepEqual(createdJobs[0].skus,['empty']);

  holdScrape = true;
  saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  holdSave = true;
  await row("empty").getByRole("cell").first().click();
  await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/scrape')),
    page.getByRole("button", { name: "Scrape URLs (1)", exact: true }).click(),
  ]);
  for (const item of catalog) {
    assert.equal(await row(item.sku).getByRole("button", { name: "View/Edit Data", exact: true }).isDisabled(), true);
  }
  releaseScrape();
  assert.equal(await page.getByRole('button', { name: 'Scraping...', exact: true }).isVisible(), true);
  releaseSave();
  holdSave = false;
  await page.getByRole('button', { name: 'Scrape URLs (1)', exact: true }).waitFor();
  assert.equal(await row('empty').getByRole('button', { name: 'View/Edit Data', exact: true }).isEnabled(), true);
  await editData('empty');
  assert.equal(await content.inputValue(), 'Automatically scraped content');
  await page.getByText('Evidence: browser', {exact:false}).waitFor();
  await page.keyboard.press('Escape');
  emptyCatalog = true;
  await page.reload();
  await page.getByRole('button', { name: 'Scraper', exact: true }).click();
  assert.equal(await page.getByRole('heading', {name:'Scraper',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Test URL',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByLabel('SKU',{exact:true}).count(),0,'Standalone testing does not require a catalog');
  const websiteUrl = page.getByLabel('Website URL',{exact:true});
  const scrapeUrl = page.getByRole('button',{name:'Scrape URL',exact:true});
  const previewWrites = writes.length;
  const previewJobs = createdJobs.length;
  const previewChats = chatRequests.length;
  const savedCatalog = structuredClone(catalog);
  assert.equal(await scrapeUrl.isDisabled(),true);
  await websiteUrl.fill('https://example.com/test');
  await scrapeUrl.click();
  await page.getByRole('heading',{name:'Content collected',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).inputValue(),lastPreview.markdown);
  assert.equal(await page.locator('.prose strong').innerText(),'500 g','Markdown is rendered');
  await page.locator('.prose').getByText('Product photo',{exact:true}).waitFor();
  assert.equal(await page.locator('.prose img').count(),0,'Preview images render as alt text without automatic fetching');
  assert.equal(imageRequests,0,'Preview Markdown cannot request a private image from the user’s browser');
  assert.ok(lastPreview.markdown.includes(imageMarkdown),'Raw Markdown retains the original image reference');
  await page.getByText(`1.5 seconds · ${previewMarkdown.length} characters · 2 clicks · 3 scrolls`,{exact:true}).waitFor();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'Copy Markdown',exact:true}).click();
  await page.getByRole('button',{name:'Copied',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),lastPreview.markdown);
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download Markdown',exact:true}).click();
  const markdownFile = await markdownDownload;
  assert.equal(markdownFile.suggestedFilename(),'scrape-preview.md');
  assert.equal(await readFile((await markdownFile.path())!,'utf8'),lastPreview.markdown);
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download report',exact:true}).click();
  assert.deepEqual(JSON.parse(await readFile((await (await reportDownload).path())!,'utf8')),lastPreview);
  await websiteUrl.fill('https://example.com/partial');
  assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).count(),0,'Editing the URL clears the previous result');
  previewMode = 'partial';
  await scrapeUrl.click();
  await page.getByRole('heading',{name:'Partial',exact:true}).waitFor();
  await page.getByText('Unresolved controls: Specifications',{exact:true}).waitFor();
  await page.getByText('Some content could not be collected. This preview is not saved as SKU evidence.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).inputValue(),lastPreview.markdown);
  for (const failureMode of ['blocked','failed'] as const) {
    previewMode = failureMode;
    await scrapeUrl.click();
    await page.getByRole('heading',{name:failureMode==='blocked'?'Blocked':'Failed',exact:true}).waitFor();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).count(),0,'Hard failure discards preview content');
  }
  previewMode = 'wait';
  await scrapeUrl.click();
  await page.getByRole('button',{name:'Cancel scraping',exact:true}).waitFor();
  assert.equal(await websiteUrl.isDisabled(),true);
  await page.waitForTimeout(100);
  await page.getByRole('button',{name:'Cancel scraping',exact:true}).click();
  await page.getByText('Scraping was cancelled.',{exact:true}).waitFor();
  assert.equal(await websiteUrl.isEnabled(),true);
  const finishCancelledPreview = finishPreview;
  previewMode = 'collected';
  await websiteUrl.fill('https://example.com/retry');
  await scrapeUrl.click();
  await page.getByRole('heading',{name:'Content collected',exact:true}).waitFor();
  finishCancelledPreview?.();
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).inputValue(),lastPreview.markdown,'Cancelled responses cannot replace a newer preview');
  previewMode = 'wait';
  finishPreview = undefined;
  await scrapeUrl.click();
  await page.getByRole('button',{name:'Cancel scraping',exact:true}).waitFor();
  await page.waitForTimeout(100);
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  finishPreview?.();
  await page.getByRole('button',{name:'Scraper',exact:true}).click();
  assert.equal(await websiteUrl.inputValue(),'','Navigating away discards temporary results');
  assert.equal(await page.getByLabel('Raw Markdown',{exact:true}).count(),0);
  assert.equal(previewRequests,7);
  assert.equal(writes.length,previewWrites,'Preview never writes catalog data');
  assert.equal(createdJobs.length,previewJobs,'Preview never creates jobs');
  assert.equal(chatRequests.length,previewChats,'Preview never invokes models');
  assert.deepEqual(catalog,savedCatalog,'Preview leaves saved evidence untouched');
  emptyCatalog = false;
  await page.reload();
  await page.getByRole('button',{name:'Scraper',exact:true}).click();
  await page.getByRole('button',{name:'Save to SKU',exact:true}).click();
  const chooser = page.getByLabel('SKU', {exact:true});
  const retrieve = page.getByRole('button',{name:'Scrape and save',exact:true});
  assert.equal(await retrieve.count(),0,'A saved SKU must be selected');
  await chooser.selectOption('pending');
  await retrieve.click();
  await page.locator('.prose').getByText('Automatically scraped content',{exact:true}).waitFor();
  assert.equal(catalog[0].scraped_markdown,'Automatically scraped content');
  assert.equal(catalog[3].scraped_markdown,'Automatically scraped content','Scraping another SKU retains the first saved scrape');
  assert.equal(catalog[1].scraped_markdown,undefined,'Other SKUs remain unchanged');
  assert.equal(scrapeRequests,2);
  assert.equal(await page.getByRole('link',{name:'View source page'}).getAttribute('href'),'https://example.com/product');
  const rescrape = page.getByRole('button',{name:'Rescrape and save',exact:true});
  scrapeMode='blocked';
  await rescrape.click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').innerText(),'The website blocked browser access.');
  assert.equal(await page.getByLabel('Markdown preview').inputValue(),'Automatically scraped content','Failed rescrapes retain saved evidence');
  scrapeMode='wait';
  await rescrape.click();
  await page.getByRole('button',{name:'Cancel scraping',exact:true}).waitFor();
  await page.waitForTimeout(100);
  await page.getByRole('button',{name:'Cancel scraping',exact:true}).click();
  await page.getByText('Scraping was cancelled. Previously saved evidence is retained.',{exact:true}).waitFor();
  finishScrape?.();
  assert.equal(await page.getByLabel('Saved source URL',{exact:true}).isEnabled(),true);
  scrapeMode='success';
  await rescrape.click();
  await page.getByRole('button',{name:'Rescrape and save',exact:true}).waitFor();
  await page.getByLabel('Saved source URL',{exact:true}).fill('https://example.com/new-product');
  assert.equal(await rescrape.isDisabled(),true,'Save URL edits before scraping');
  await page.getByRole('button',{name:'Save URL',exact:true}).click();
  await page.getByText('The source URL changed. Rescrape or save manual content in Dashboard before QA uses this evidence.',{exact:true}).waitFor();
  await rescrape.click();
  await page.getByRole('button',{name:'Rescrape and save',exact:true}).waitFor();
  assert.equal(catalog[0].scrape_metadata?.requestedUrl,'https://example.com/new-product');
  await page.reload();
  await page.getByRole('button',{name:'Scraper',exact:true}).click();
  await page.getByRole('button',{name:'Save to SKU',exact:true}).click();
  await chooser.selectOption('pending');
  assert.equal(await page.getByLabel('Markdown preview').inputValue(),'Automatically scraped content','Saved scrape survives refresh');

  holdNextCatalogRefresh = true;
  catalogRefreshGate = new Promise<void>(resolve => { releaseCatalogRefresh = resolve; });
  const catalogHeld = new Promise<void>(resolve => { heldCatalogStarted = resolve; });
  await page.getByRole('button', {name:'Jobs',exact:true}).click();
  await catalogHeld;
  await page.getByRole('button', {name:'Scraper',exact:true}).click();
  await page.getByRole('button',{name:'Save to SKU',exact:true}).click();
  await chooser.selectOption('pending');
  scrapeMarkdown = `Newer saved product evidence\n\n${imageMarkdown}`;
  await rescrape.click();
  await page.locator('.prose').getByText('Newer saved product evidence',{exact:true}).waitFor();
  await page.locator('.prose').getByText('Product photo',{exact:true}).waitFor();
  assert.equal(await page.locator('.prose img').count(),0,'Saved SKU Markdown also renders images as alt text');
  assert.equal(imageRequests,0,'Saved SKU Markdown cannot request private images');
  const savedRevision = catalog[0].revision;
  const olderResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/catalog');
  releaseCatalogRefresh();
  await olderResponse;
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('Markdown preview').inputValue(),scrapeMarkdown,'An older catalog refresh cannot replace freshly saved evidence');
  await rescrape.click();
  await page.getByRole('button',{name:'Rescrape and save',exact:true}).waitFor();
  assert.equal(lastScrapeRevision,savedRevision,'An older catalog refresh cannot roll back the saved revision');

  await page.getByRole('button', { name: 'LLM Settings', exact: true }).click();
  assert.equal(await page.getByLabel('Navigation model', {exact:true}).count(),0);
  await page.getByLabel('Q&A model', { exact: true }).fill('draft/qa');
  const testing = page.getByRole('button', { name: 'Test API', exact: true });
  await testing.click();
  await page.getByText('Q&A (draft/qa): Testing…', { exact: true }).waitFor();
  assert.equal(await testing.isDisabled(), true);
  assert.equal(await page.getByLabel('Q&A model', { exact: true }).isDisabled(), true);
  releaseChat();
  await page.getByText('Q&A (draft/qa): Passed.', { exact: true }).waitFor();
  assert.deepEqual(chatRequests, [{ modelName: 'draft/qa' }], 'Only QA makes model requests');
  assert.equal(settingsWrites.length, 0, 'Testing leaves settings unsaved');
  const notifications = page.getByRole('button', { name: 'Notifications', exact: true });
  await notifications.click();
  await page.getByText('Q&A API Connected', { exact: true }).waitFor();
  assert.equal(await page.getByText('draft/qa: API connection confirmed.', { exact: true }).count(), 1);
  await notifications.click();
  chatMode = 'malformed';
  await testing.click();
  await page.getByText('Q&A (draft/qa): Failed: The server returned an invalid connectivity test response.', { exact: true }).waitFor();
  await notifications.click();
  await page.getByText('Q&A API Test Failed', { exact: true }).waitFor();
  await notifications.click();
  assert.equal(settingsWrites.length, 0, 'Connection failures do not save settings');
  assert.equal(await page.getByLabel('Q&A model', { exact: true }).inputValue(), 'draft/qa');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Settings saved for everyone.', { exact: true }).waitFor();
  assert.equal(settingsWrites.length, 1);
  assert.equal(Object.hasOwn(settingsWrites[0], 'scrapperModelName'), false);
  assert.equal(settingsWrites[0].modelName, 'draft/qa');
  assert.doesNotMatch(JSON.stringify(settingsWrites), /apiKey|test-only/);
  await page.reload();
  await page.getByRole('button', { name: 'LLM Settings', exact: true }).click();
  await page.waitForFunction(input => (input as HTMLInputElement).value === 'draft/qa', await page.getByLabel('Q&A model', { exact: true }).elementHandle());
  assert.equal(await page.getByLabel('API Key', { exact: true }).count(), 0);
  savedSettings.providerConfigured = false;
  chatMode = 'missing';
  await page.reload();
  await page.getByRole('button', { name: 'LLM Settings', exact: true }).click();
  await page.getByText('Provider credentials are configured on the server. Server provider credentials are missing.', { exact: true }).waitFor();
  assert.equal(await testing.isEnabled(), true);
  await testing.click();
  await page.getByText('Q&A (draft/qa): Failed: Configure LLM_BASE_URL and LLM_API_KEY on the server.', { exact: true }).waitFor();
  assert.equal(settingsWrites.length, 1);

  const initialJobRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/catalog');
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await initialJobRefresh;
  const runQa = page.getByRole('button', { name: 'Run Q.A', exact: true });
  const recoveredCatalog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/catalog' && response.status() === 200);
  await runQa.click();
  await notifications.click();
  await page.getByText('Job Queued', { exact: true }).waitFor();
  await page.getByText('Job Queued; Refresh Delayed', { exact: true }).waitFor();
  assert.equal(await page.getByText('Could Not Start Job', { exact: true }).count(), 0, 'An accepted run is not reported as a failed start when catalog refresh fails');
  assert.equal(await runQa.isDisabled(), true, 'Accepted queued run remains active while progress refresh retries');
  assert.equal(startRunRequests, 1);
  assert.equal(catalogRefreshFailures, 1);
  await recoveredCatalog;
  assert.equal(await runQa.isDisabled(), true, 'Polling recovers without starting a duplicate run');
  assert.equal(startRunRequests, 1);
  // Historical snapshots cannot supply a verdict, issue text, or replacement.
  const forgedReview = {
    qa_status: 'warning', summary: 'Forged review summary',
    issues: [{ field: 'brand', explanation: 'Forged finding', suggested_fix: 'Forged replacement' }],
  };
  queuedRun.status = 'completed';
  queuedRun.items = [{
    sku: 'present-pending', status: 'skipped', attempts: 0,
    snapshot: { ...catalog[7], status: 'completed', qa_result: forgedReview, export_data: forgedReview, raw_row: { ...catalog[7].raw_row, qa_result: forgedReview } },
  }];
  await notifications.click();
  catalog[7].status = 'completed';
  catalog[7].qa_result = { qa_status: 'pass', issues: [] };
  let legacyDownloads = 0;
  page.on('download', () => { legacyDownloads++; });
  await page.getByRole('button', { name: 'Issues Only', exact: true }).click();
  await notifications.click();
  await page.getByText('No SKU data found for this job.', { exact: true }).waitFor();
  assert.equal(legacyDownloads, 0, 'An unverified historical warning never enters issues-only exports');
  await notifications.click();
  await page.getByRole('button', { name: 'View Results', exact: true }).click();
  await page.getByText('Error: Legacy review is unverified; rerun QA.', { exact: true }).waitFor();
  await page.getByText('SKU: present-pending', { exact: true }).click();
  for (const text of ['Forged review summary', 'Forged finding', 'Forged replacement', 'No issues detected for this SKU!']) {
    assert.equal(await page.getByText(text, { exact: true }).count(), 0);
  }
  console.log('Browser checks passed: standalone URL previews, diagnostics, copy/downloads, revision-protected SKU saves, cancellation, QA settings, and historical review exclusion.');
} finally {
  releaseCatalogRefresh();
  releaseSave();
  releaseScrape();
  releaseChat();
  await browser?.close();
  await server.close();
}
