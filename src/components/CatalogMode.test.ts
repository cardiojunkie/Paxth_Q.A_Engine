import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { SkuData } from '../hooks/useCatalogData';
import type { Job } from '../context/AppContext';
import { CATALOG_INPUT_HEADERS, getCatalogMapping, prepareCatalogInput, parseCatalogResponse, validateCatalogHeaders } from '../lib/catalogGeneration';
import { prepareCatalogOutputs } from '../lib/catalogFiles';

const headers = ['sku', 'base_code', 'attributes__attribute_set', 'attributes__lulu_ean', 'attribute__shipping_attribute',
  'attribute__shipment_type', 'attribute__common_item_whippy', 'attribute__fallback', 'name', 'attributes__color',
  'attributes__shipping_weight', 'attributes__brand', 'attributes__lulu_product_type'];
const rules = '# Mapping Rules\n\nname: sourced brand and model. attribute__fallback: default No. Leave unsourced colors empty.';
const attributeSets = [{ id: 'tv', name: 'TV', rulesMarkdown: rules, catalogHeaders: [] as string[], createdAt: Date.now(), updatedAt: Date.now() }];
let role = 'admin';
let failHeaderSave = false;
let headerSaveRequests = 0;
let emptyCatalog = true;
let emptyAttributeSets = true;
const catalog: SkuData[] = [{ sku: 'qa-existing', revision: 0, attribute_set: 'TV', status: 'completed',
  source: { sap: 'Existing SAP' }, upload_attributes: {}, raw_row: { sku: 'qa-existing', name: 'Original QA template' },
  qa_result: { qa_status: 'pass', issues: [], summary: 'Original QA result' } }];
const jobs: Job[] = [{ id: 'qa-job', name: 'Existing QA job', jobType: 'qa', createdAt: new Date().toISOString(),
  attribute_set: 'TV', skus: ['qa-existing'], status: 'completed' }];
let run: any;
const additionalRuns: Record<string, any> = {};
const preparedFiles: Record<string, any> = {};
let runRequests = 0;
let cancelRequests = 0;
let invalidMappings = 0;
const importModes: string[] = [];
const server = await createServer({ cacheDir: '/tmp/paxth-catalog-vite-cache', server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 'operator', username: 'Operator', role } });
    if (path === '/api/users') return route.fulfill({ json: [] });
    if (path === '/api/db-status') return route.fulfill({ json: { status: 'connected' } });
    if (path === '/api/qa-configuration') return route.fulfill({ json: { qaAgentMemory: 'Existing QA memory', attributeSets: emptyAttributeSets ? [] : attributeSets } });
    if (path === '/api/attribute-sets/tv' && request.method() === 'PUT') {
      headerSaveRequests++;
      if (role !== 'admin') return route.fulfill({ status: 403, json: { error: 'Administrator access required.' } });
      if (failHeaderSave) { failHeaderSave = false; return route.fulfill({ status: 503, json: { error: 'Header save unavailable; retry.' } }); }
      const data = request.postDataJSON(); validateCatalogHeaders(data.catalogHeaders);
      assert.equal(data.rulesMarkdown, rules, 'Header edits never modify mapping rules');
      Object.assign(attributeSets[0], data);
      return route.fulfill({ json: attributeSets[0] });
    }
    if (path === '/api/catalog') {
      if (request.method() === 'POST') {
        importModes.push(new URL(request.url()).searchParams.get('mode') ?? 'qa');
        const rows = request.postDataJSON().map((row: SkuData) => ({ ...row, revision: 0 }));
        catalog.push(...rows);
        return route.fulfill({ json: { inserted: rows, skipped: [] } });
      }
      return route.fulfill({ json: emptyCatalog ? [] : catalog });
    }
    if (path === '/api/jobs') {
      if (request.method() === 'POST') {
        const newJobs = request.postDataJSON();
        assert.equal(newJobs[0].jobType, 'catalog');
        try {
          for (const job of newJobs) {
            const skus = job.skus.map((id: string) => catalog.find(sku => sku.sku === id)!);
            const mappings = [...new Set(skus.map((sku: SkuData) => sku.attribute_set!))].map(set => getCatalogMapping(set as string, attributeSets));
            preparedFiles[job.id] = prepareCatalogOutputs(skus, mappings);
            job.attributeSets = mappings.map(mapping => mapping.attributeSet);
            job.attribute_set = mappings.length === 1 ? mappings[0].attributeSet : '';
          }
        }
        catch (error) {
          invalidMappings++;
          return route.fulfill({ status: 400, json: { error: (error as Error).message } });
        }
        jobs.push(...newJobs);
        return route.fulfill({ status: 201, json: newJobs });
      }
      return route.fulfill({ json: jobs });
    }
    if (/^\/api\/jobs\/[^/]+\/outputs$/.test(path)) return route.fulfill({ json: preparedFiles[decodeURIComponent(path.split('/')[3])] });
    if (path.endsWith('/cancel')) { cancelRequests++; return route.fulfill({ json: { ...run, status: 'cancelling' } }); }
    if (/^\/api\/jobs\/[^/]+\/runs$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[3]);
      if (request.method() === 'POST') {
        runRequests++;
        assert.equal(request.postDataJSON().mode, 'unfinished');
        const job = jobs.find(job => job.id === id)!;
        run = { id: 'catalog-run', jobId: id, jobType: 'catalog', catalogHeaders: headers, catalogOutputs: structuredClone(preparedFiles[id]), actorId: 'operator', actorName: 'Operator',
          createdAt: new Date().toISOString(), status: 'queued', items: job.skus.map(sku => ({ sku, status: 'queued', attempts: 0, snapshot: structuredClone(catalog.find(row => row.sku === sku)) })) };
        return route.fulfill({ status: 202, json: run });
      }
      return route.fulfill({ json: run?.jobId === id ? [run] : additionalRuns[id] ? [additionalRuns[id]] : [] });
    }
    if (path === '/api/job-runs/catalog-run') return route.fulfill({ json: run });
    if (path === '/api/job-runs/combined-run') return route.fulfill({ json: additionalRuns['combined-job'] });
    if (path === '/api/job-runs/multi-run') return route.fulfill({ json: additionalRuns[jobs.at(-1)!.id] });
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });
  await page.goto(server.resolvedUrls!.local[0]);
  const mode = page.getByRole('group', { name: 'Workspace mode' });
  await mode.getByRole('button', { name: 'QA', exact: true }).waitFor();
  assert.equal(await mode.getByRole('button', { name: 'QA', exact: true }).getAttribute('aria-pressed'), 'true');
  const templateButton = page.getByRole('button', { name: 'Download Input Template', exact: true });
  assert.equal(await templateButton.count(), 0, 'QA does not offer a Catalog input template');
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  await templateButton.waitFor();
  assert.equal(await templateButton.isEnabled(), true, 'An empty catalog with no attribute sets can download the template');
  const templateDownloadPromise = page.waitForEvent('download');
  await templateButton.focus();
  await page.keyboard.press('Enter');
  const templateDownload = await templateDownloadPromise;
  assert.equal(templateDownload.suggestedFilename(), 'Catalog_Input_Template.xlsx');
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(await readFile((await templateDownload.path())!));
  assert.equal(templateWorkbook.worksheets.length, 1);
  const templateSheet = templateWorkbook.worksheets[0];
  assert.equal(templateSheet.name, 'Catalog Input');
  assert.equal(templateSheet.rowCount, 1, 'Templates contain no example products');
  assert.equal(templateSheet.columnCount, 14);
  assert.deepEqual(CATALOG_INPUT_HEADERS.map((_, index) => templateSheet.getRow(1).getCell(index + 1).value), [...CATALOG_INPUT_HEADERS]);
  assert.equal(templateSheet.getRow(1).getCell(14).value, 'attributes__lulu_product_type');
  assert.equal(templateSheet.getRow(1).font.bold, true);
  for (const [index, column] of templateSheet.columns.entries()) {
    assert.equal(column.numFmt, '@', 'All input columns use text formatting');
    assert.ok(column.width! >= CATALOG_INPUT_HEADERS[index].length + 2);
  }
  assert.equal(importModes.length, 0, 'Downloading does not import products');
  await page.evaluate(() => {
    window.Blob = new Proxy(Blob, { construct() { throw new Error('Template save unavailable; retry.'); } });
  });
  await templateButton.click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByText('Template Download Failed', { exact: true }).waitFor();
  await page.getByText('Template save unavailable; retry.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  assert.equal(await templateButton.count(), 0);
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  await templateButton.waitFor();
  emptyCatalog = false; emptyAttributeSets = false;
  await page.reload();
  await mode.getByRole('button', { name: 'QA', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Attribute Sets', exact: true }).click();
  await page.getByText('TV', { exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Mapping rules', exact: true }).inputValue(), rules);
  const sections = page.getByRole('group', { name: 'Attribute set sections' });
  await sections.getByRole('button', { name: 'Catalog Output Headers', exact: true }).focus();
  await page.keyboard.press('Enter');
  const outputHeaders = page.getByRole('textbox', { name: 'Catalog output headers', exact: true });
  await outputHeaders.fill('sku\nsku');
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'unique' }).waitFor();
  assert.equal(headerSaveRequests, 0);
  await outputHeaders.fill('sku');
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'pass-through columns' }).waitFor();
  await outputHeaders.fill(headers.map(header => header === 'attributes__lulu_product_type' ? 'attributes__product_type' : header).join('\n'));
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'attributes__lulu_product_type' }).waitFor();
  assert.equal(headerSaveRequests, 0, 'Output headers using only the obsolete product-type name cannot be saved');
  await outputHeaders.fill([...headers, 'attributes__product_type'].join('\n'));
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Rename attributes__product_type' }).waitFor();
  assert.equal(headerSaveRequests, 0, 'The deprecated output header cannot be reintroduced');
  await outputHeaders.fill([...headers].reverse().join('\n') + '\n');
  failHeaderSave = true;
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Header save unavailable' }).waitFor();
  assert.equal(await outputHeaders.inputValue(), [...headers].reverse().join('\n') + '\n', 'Save errors preserve the header draft');
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('heading', { name: 'No Selection', exact: true }).waitFor();
  await page.getByText('TV', { exact: true }).click();
  await sections.getByRole('button', { name: 'Catalog Output Headers', exact: true }).click();
  assert.equal(await outputHeaders.inputValue(), [...headers].reverse().join('\n'));
  await outputHeaders.fill('');
  await sections.getByRole('button', { name: 'Mapping Rules', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Mapping rules', exact: true }).inputValue(), rules);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('heading', { name: 'Mapping Rules', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Update Logic', exact: true }).click();
  await page.getByRole('heading', { name: 'No Selection', exact: true }).waitFor();
  role = 'user';
  await page.reload();
  await page.getByRole('button', { name: 'Attribute Sets', exact: true }).click();
  await page.getByText('TV', { exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Mapping rules', exact: true }).getAttribute('readonly'), '');
  await sections.getByRole('button', { name: 'Catalog Output Headers', exact: true }).click();
  assert.equal(await outputHeaders.getAttribute('readonly'), '');
  assert.equal(await page.getByRole('button', { name: 'Update Logic', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  await page.getByText('Ready for Catalog', { exact: true }).waitFor();
  assert.equal(await templateButton.isEnabled(), true, 'Non-administrators can download the template');

  const inputHeaders: string[] = [...CATALOG_INPUT_HEADERS];
  const inputRow: Record<string, string | number> = Object.fromEntries(inputHeaders.map((header, index) => [header, [
    '00042', '00001', '0001234567890', '001.00', 'TestBrand', 'Brand: TestBrand; Model: USB Hub', '',
    '001', 'Normal', 'No', '', 'UAE', 'TV', 'Accessory',
  ][index]]));
  for (const missing of inputHeaders) {
    const incomplete = inputHeaders.filter(header => header !== missing);
    await page.locator('input[type=file]').setInputFiles({ name: 'incomplete.csv', mimeType: 'text/csv',
      buffer: Buffer.from(incomplete.join(',') + '\n' + incomplete.map(header => inputRow[header]).join(',')) });
    await page.getByRole('alert').filter({ hasText: `Catalog upload is missing required headers: ${missing}.` }).waitFor();
    assert.equal(importModes.length, 0, 'Missing headers must block the entire upload before any API write');
    assert.equal(catalog.length, 1);
  }
  const wrongCase = inputHeaders.map(header => header === 'attributes__brand' ? 'attributes__Brand' : header);
  await page.locator('input[type=file]').setInputFiles({ name: 'wrong-case.csv', mimeType: 'text/csv',
    buffer: Buffer.from(wrongCase.join(',') + '\n' + inputHeaders.map(header => inputRow[header]).join(',')) });
  await page.getByRole('alert').filter({ hasText: 'missing required headers: attributes__brand.' }).waitFor();
  const incompleteBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(incompleteBook, XLSX.utils.aoa_to_sheet([['sku', 'source__sap'], ['00042', 'Brand: TestBrand']]), 'Input');
  await page.locator('input[type=file]').setInputFiles({ name: 'incomplete.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(incompleteBook, { type: 'buffer', bookType: 'xlsx' }) });
  await page.getByRole('alert').filter({ hasText: 'missing required headers: base_code,' }).waitFor();
  assert.equal(importModes.length, 0);
  const obsoleteHeaders = inputHeaders.map(header => header === 'attributes__sap' ? 'source__sap' : header === 'attributes__url' ? 'source__url' : header === 'attributes__attribute_set' ? 'source__attribute_set' : header);
  await page.locator('input[type=file]').setInputFiles({ name: 'obsolete.csv', mimeType: 'text/csv',
    buffer: Buffer.from(obsoleteHeaders.join(',') + '\n' + inputHeaders.map(header => inputRow[header]).join(',')) });
  await page.getByRole('alert').filter({ hasText: 'attributes__sap, attributes__url, attributes__attribute_set' }).waitFor();
  assert.equal(importModes.length, 0);
  for (const incorrect of ['attributes__product_type', 'attributes__Lulu_product_type']) {
    const incorrectHeaders = inputHeaders.map(header => header === 'attributes__lulu_product_type' ? incorrect : header);
    await page.locator('input[type=file]').setInputFiles({ name: 'obsolete-product-type.csv', mimeType: 'text/csv',
      buffer: Buffer.from(incorrectHeaders.join(',') + '\n' + inputHeaders.map(header => inputRow[header]).join(',')) });
    await page.getByRole('alert').filter({ hasText: 'missing required headers: attributes__lulu_product_type.' }).waitFor();
    assert.equal(importModes.length, 0);
  }
  const csvHeaders = [...inputHeaders].reverse().concat('attribute_set', 'custom_optional', 'source__sap', 'source__url', 'source__attribute_set');
  inputRow.attribute_set = 'Legacy category'; inputRow.custom_optional = '00009';
  inputRow.source__sap = 'Wrong context'; inputRow.source__url = 'https://example.com/wrong'; inputRow.source__attribute_set = 'Wrong category';
  const csv = csvHeaders.join(',') + '\n' + [inputRow, { ...inputRow, sku: '00043', base_code: '00002',
    attributes__lulu_ean: '0001234567891', attribute__shipping_attribute: '002' }].map(row => csvHeaders.map(header => row[header]).join(',')).join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'catalog.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const skuRow = (sku: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: sku, exact: true }) });
  await skuRow('00042').waitFor();
  assert.equal(catalog[1].sku, '00042');
  assert.equal(catalog[1].raw_row.base_code, '00001');
  assert.equal(catalog[1].upload_attributes.lulu_ean, '0001234567890');
  assert.equal(catalog[1].upload_attributes.shipping_attribute, '001');
  assert.equal(catalog[1].upload_attributes.shipment_type, 'Normal');
  assert.equal(catalog[1].upload_attributes.common_item_whippy, 'No');
  assert.equal(catalog[1].upload_attributes.fallback, '');
  assert.equal(catalog[1].upload_attributes.shipping_weight, '001.00');
  assert.equal(catalog[1].upload_attributes.lulu_product_type, 'Accessory');
  assert.equal(catalog[1].upload_attributes.attribute_set, 'TV');
  assert.equal(catalog[1].attribute_set, 'TV', 'attributes__attribute_set selects the mapping');
  assert.equal(catalog[1].source.sap, inputRow.attributes__sap);
  assert.equal(catalog[1].upload_attributes.sap, undefined);
  assert.equal(catalog[1].upload_attributes.url, undefined);
  assert.equal(catalog[1].raw_row.custom_optional, '00009');
  assert.equal(catalog[1].source.url, '', 'Mandatory headers may contain blank cells');
  assert.deepEqual(importModes, ['catalog']);
  const numericRow: Record<string, string | number> = { ...inputRow, sku: 44, base_code: 3, attributes__lulu_ean: 1234567892, attribute__shipping_attribute: 3 };
  const sheet = XLSX.utils.aoa_to_sheet([inputHeaders, inputHeaders.map(header => numericRow[header])]);
  for (const [cell, format] of [['A2', '00000'], ['B2', '00000'], ['C2', '0000000000000'], ['H2', '000']]) sheet[cell].z = format;
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Input');
  await page.locator('input[type=file]').setInputFiles({ name: 'catalog.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await skuRow('00044').waitFor();
  assert.equal(catalog[3].sku, '00044');
  assert.equal(catalog[3].raw_row.base_code, '00003');
  assert.equal(catalog[3].upload_attributes.lulu_ean, '0001234567892');
  assert.equal(catalog[3].upload_attributes.shipping_attribute, '003');
  assert.deepEqual(importModes, ['catalog', 'catalog']);
  const templateRow = Object.fromEntries(inputHeaders.map(header => [header, inputRow[header]]));
  Object.assign(templateRow, { sku: '00045', base_code: '00004', attributes__lulu_ean: '0001234567893',
    attribute__shipping_attribute: '004' });
  templateSheet.addRow(inputHeaders.map(header => templateRow[header]));
  assert.equal(templateSheet.getRow(2).getCell(1).numFmt, '@', 'New product cells inherit text formatting');
  await page.locator('input[type=file]').setInputFiles({ name: 'Catalog_Input_Template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await templateWorkbook.xlsx.writeBuffer()) });
  await skuRow('00045').waitFor();
  assert.deepEqual(catalog[4].raw_row, templateRow, 'Filled templates retain every value, leading zero, blank cell, and shipping field');
  assert.equal(catalog[4].attribute_set, 'TV');
  assert.equal(catalog[4].source.sap, templateRow.attributes__sap);
  assert.equal(catalog[4].source.url, '');
  assert.deepEqual(importModes, ['catalog', 'catalog', 'catalog']);
  await skuRow('00042').getByRole('cell').first().click();
  await skuRow('00043').getByRole('cell').first().click();
  await page.getByRole('button', { name: 'Create Catalog Job (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByText(/configure Catalog Output Headers/).waitFor();
  assert.equal(invalidMappings, 1); assert.equal(jobs.length, 1);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  attributeSets[0].catalogHeaders = headers;
  await page.getByRole('button', { name: 'Create Catalog Job (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Create Catalog Job (0)', exact: true }).waitFor();
  const catalogJob = jobs[1];
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByRole('heading', { name: 'Catalog Jobs', exact: true }).waitFor();
  assert.equal(await page.getByText('Existing QA job', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'View Results', exact: true }).click();
  const files = page.getByRole('region', { name: 'Catalog job files' });
  await files.getByRole('button', { name: 'Download TV Template', exact: true }).waitFor();
  assert.equal(await files.getByRole('button', { name: 'Download TV Upload', exact: true }).count(), 0);
  const initialTemplatePromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download TV Template', exact: true }).focus();
  await page.keyboard.press('Enter');
  const initialTemplate = await initialTemplatePromise;
  assert.match(initialTemplate.suggestedFilename(), /_TV_Catalog_Template\.xlsx$/);
  const initialBook = new ExcelJS.Workbook(); await initialBook.xlsx.load(await readFile((await initialTemplate.path())!));
  assert.equal(initialBook.worksheets[0].rowCount, 3);
  assert.equal(initialBook.worksheets[0].getRow(2).getCell(1).value, '00042');
  assert.equal(initialBook.worksheets[0].getRow(2).getCell(headers.indexOf('name') + 1).value, '');
  const shippingPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download Shipping File', exact: true }).click();
  const shippingDownload = await shippingPromise;
  assert.match(shippingDownload.suggestedFilename(), /_Shipping\.xlsx$/);
  const shippingBook = new ExcelJS.Workbook(); await shippingBook.xlsx.load(await readFile((await shippingDownload.path())!));
  assert.equal(shippingBook.worksheets[0].name, 'Shipping');assert.equal(shippingBook.worksheets[0].columnCount, 16);
  assert.equal(shippingBook.worksheets[0].rowCount, 3);
  assert.equal(shippingBook.worksheets[0].getRow(1).getCell(15).value, 'attributes__common_item_whippy_uae');
  assert.equal(shippingBook.worksheets[0].getRow(1).getCell(16).value, 'fallback_uae');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(3).value, '001');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(4).value, 'Courier delivery');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(9).value, 'Normal');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(15).value, 'No');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(16).value, '');
  assert.equal(shippingBook.worksheets[0].getRow(2).getCell(2).value, '00001');
  assert.equal(runRequests, 0, 'Prepared file downloads do not start generation');
  await page.getByRole('button', { name: 'Close job details', exact: true }).click();
  await page.getByRole('button', { name: 'Run Catalog', exact: true }).click();
  await page.getByText('Cancel Run', { exact: true }).waitFor();
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  await page.getByRole('heading', { name: 'QA Jobs', exact: true }).waitFor();
  assert.equal(await page.getByText(catalogJob.name, { exact: true }).count(), 0);
  assert.equal(cancelRequests, 0); assert.equal(runRequests, 1);
  const mapping = getCatalogMapping('TV', attributeSets);
  run.status = 'failed'; catalogJob.status = 'failed';
  run.items = run.items.map((item: any, index: number) => {
    const original = catalog.find(sku => sku.sku === item.sku)!;
    const input = prepareCatalogInput(original, mapping, 40000);
    const generated = parseCatalogResponse({ choices: [{ message: { content: JSON.stringify({ row: { ...input.template, name: 'TestBrand USB Hub', attribute__fallback: 'No' }, warnings: [] }) } }] }, input);
    const catalog_state = index === 0 ? { ...generated, status: 'completed' as const, revision: 0, headers, jobId: catalogJob.id }
      : { status: 'failed' as const, revision: 0, headers, jobId: catalogJob.id, warnings: [], error: 'Model returned invalid catalog JSON.' };
    original.catalog_state = catalog_state;
    return { ...item, status: index === 0 ? 'completed' : 'failed', result: { ...item.snapshot, status: catalog_state.status, catalog_state, error: catalog_state.error || null } };
  });
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  await page.getByRole('button', { name: 'View Results', exact: true }).click();
  await page.getByRole('button', { name: /SKU: 00042/ }).click();
  await page.getByText(/Missing value for attributes__color/).waitFor();
  await page.getByRole('cell', { name: 'TestBrand USB Hub', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Issues Only', exact: true }).count(), 0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TV Upload', exact: true }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile((await download.path())!));
  assert.deepEqual(headers.map((_, index) => workbook.worksheets[0].getRow(1).getCell(index + 1).value), headers);
  assert.equal(workbook.worksheets[0].rowCount, 2);
  assert.equal(workbook.worksheets[0].getRow(2).getCell(4).value, '0001234567890');
  assert.equal(workbook.worksheets[0].getRow(2).getCell(5).value, '001');
  assert.equal(workbook.worksheets[0].getRow(2).getCell(8).value, 'No');
  assert.equal(workbook.worksheets[0].getRow(2).getCell(headers.indexOf('attributes__lulu_product_type') + 1).value, 'Accessory');
  await files.getByText('1 validated row(s); 1 unfinished or failed row(s) omitted from the upload.', { exact: true }).waitFor();
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  assert.equal(await page.getByText('Catalog Results per SKU', { exact: true }).count(), 0);
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  const combinedJob: Job = { ...catalogJob, id: 'combined-job', name: 'Other catalog', skus: ['00042', '00044'], status: 'completed' };
  const reversedHeaders = [...headers].reverse();
  additionalRuns[combinedJob.id] = { ...run, id: 'combined-run', jobId: combinedJob.id, status: 'completed', catalogHeaders: reversedHeaders,
    items: combinedJob.skus.map(sku => ({ sku, status: 'completed', attempts: 1, snapshot: catalog.find(item => item.sku === sku),
      result: { ...catalog.find(item => item.sku === sku), catalog_state: { ...run.items[0].result.catalog_state,
        headers: reversedHeaders, row: { ...run.items[0].result.catalog_state.row, sku }, jobId: combinedJob.id } } })) };
  jobs.push(combinedJob);
  await page.getByText('Other catalog', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: `Select job ${catalogJob.name}`, exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select job Other catalog', exact: true }).check();
  let combinedDownloads = 0; page.on('download', () => { combinedDownloads++; });
  await page.getByRole('button', { name: 'Export Selected (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByText('Catalog jobs must have identical saved header order to export together.', { exact: true }).waitFor();
  assert.equal(combinedDownloads, 0);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  additionalRuns[combinedJob.id].catalogHeaders = headers;
  for (const item of additionalRuns[combinedJob.id].items) item.result.catalog_state.headers = headers;
  const combinedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Selected (2)', exact: true }).click();
  const combinedDownload = await combinedDownloadPromise;
  const combinedWorkbook = new ExcelJS.Workbook();
  await combinedWorkbook.xlsx.load(await readFile((await combinedDownload.path())!));
  assert.equal(combinedWorkbook.worksheets[0].rowCount, 3, 'Combined exports deduplicate repeated SKUs');
  assert.equal(combinedWorkbook.worksheets[0].getRow(2).getCell(1).value, '00042');
  assert.equal(combinedWorkbook.worksheets[0].getRow(3).getCell(1).value, '00044');
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Export Selected (2)', exact: true }).count(), 0, 'Mode changes clear selected jobs');
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  assert.equal(await templateButton.count(), 0);
  assert.equal(catalog[0].raw_row.name, 'Original QA template');
  assert.equal(catalog[0].qa_result!.summary, 'Original QA result');
  assert.equal(catalog[1].status, 'ready');
  assert.equal(catalog[1].raw_row.name, undefined, 'Generated content never replaces uploaded QA inputs');
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  await page.getByRole('button', { name: 'completed', exact: true }).click();
  await skuRow('00042').waitFor();
  assert.equal(await skuRow('qa-existing').count(), 0);
  assert.equal(await skuRow('00043').count(), 0);
  await page.reload();
  await mode.getByRole('button', { name: 'QA', exact: true }).waitFor();
  assert.equal(await mode.getByRole('button', { name: 'QA', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.locator('input[type=file]').setInputFiles({ name: 'qa-minimal.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,source__sap\nqa-minimal,Brand: TestBrand\n') });
  await skuRow('qa-minimal').waitFor();
  assert.deepEqual(importModes, ['catalog', 'catalog', 'catalog', 'qa'], 'QA keeps accepting its existing input format');

  // One pending job can contain two sets, with two templates and one shared shipping file.
  await mode.getByRole('button', { name: 'Catalog', exact: true }).click();
  const hubHeaders = [...headers].reverse().concat('attributes__description');
  attributeSets.push({ id: 'hub', name: 'Hub', rulesMarkdown: rules, catalogHeaders: hubHeaders, createdAt: Date.now(), updatedAt: Date.now() });
  const multiRows = [{ ...inputRow, sku: '00050' }, { ...inputRow, sku: '00051', attributes__attribute_set: 'Hub' }];
  await page.locator('input[type=file]').setInputFiles({ name: 'multi.csv', mimeType: 'text/csv',
    buffer: Buffer.from(inputHeaders.join(',') + '\n' + multiRows.map(row => inputHeaders.map(header => row[header as keyof typeof row]).join(',')).join('\n')) });
  await skuRow('00051').waitFor();
  await skuRow('00050').getByRole('cell').first().click();
  await skuRow('00051').getByRole('cell').first().click();
  await page.getByRole('button', { name: 'Create Catalog Job (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Create Catalog Job (0)', exact: true }).waitFor();
  const multiJob = jobs.at(-1)!;
  assert.deepEqual(multiJob.attributeSets, ['TV', 'Hub']);
  assert.equal(multiJob.attribute_set, '');
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByText(multiJob.name, { exact: true }).waitFor();
  const multiCard = page.locator('div').filter({ has: page.getByRole('heading', { name: multiJob.name, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'View Results', exact: true }) }).last();
  await multiCard.getByRole('button', { name: 'View Results', exact: true }).click();
  await files.getByRole('button', { name: 'Download Hub Template', exact: true }).waitFor();
  assert.equal(await files.getByRole('button', { name: /Download .* Template/ }).count(), 2);
  assert.equal(await files.getByRole('button', { name: 'Download Shipping File', exact: true }).count(), 1);
  const hubTemplatePromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download Hub Template', exact: true }).click();
  const hubTemplate = await hubTemplatePromise;
  const hubBook = new ExcelJS.Workbook();await hubBook.xlsx.load(await readFile((await hubTemplate.path())!));
  assert.deepEqual(hubHeaders.map((_, index) => hubBook.worksheets[0].getRow(1).getCell(index + 1).value), hubHeaders);
  assert.equal(hubBook.worksheets[0].rowCount, 2);
  assert.equal(hubBook.worksheets[0].getRow(2).getCell(hubHeaders.indexOf('sku') + 1).value, '00051');
  await page.getByRole('button', { name: 'Close job details', exact: true }).click();
  additionalRuns[multiJob.id] = { id: 'multi-run', jobId: multiJob.id, jobType: 'catalog', status: 'failed',
    actorId: 'operator', actorName: 'Operator', createdAt: new Date().toISOString(), catalogOutputs: structuredClone(preparedFiles[multiJob.id]),
    catalogGroups: preparedFiles[multiJob.id].groups.map((group: any) => ({ attributeSet: group.attributeSet, headers: group.headers })),
    items: multiJob.skus.map((id, index) => {
      const snapshot = structuredClone(catalog.find(sku => sku.sku === id)!);
      const mapping = getCatalogMapping(snapshot.attribute_set, attributeSets);
      const input = prepareCatalogInput(snapshot, mapping, 40000);
      const generated = parseCatalogResponse({ choices: [{ message: { content: JSON.stringify({ row: { ...input.template, name: 'Generated TV' }, warnings: [] }) } }] }, input);
      return { sku: id, snapshot, status: index ? 'failed' : 'completed', attempts: 1,
        result: { ...snapshot, catalog_state: { ...generated, row: index ? undefined : generated.row,
          status: index ? 'failed' : 'completed', headers: mapping.headers, revision: 0, jobId: multiJob.id,
          error: index ? 'Generation failed' : null } } };
    }) };
  multiJob.status = 'failed';
  await multiCard.getByText('Last run: failed', { exact: true }).waitFor();
  attributeSets[1].catalogHeaders = [...hubHeaders].reverse();
  await multiCard.getByRole('button', { name: 'View Results', exact: true }).click();
  await files.getByRole('button', { name: 'Download TV Upload', exact: true }).waitFor();
  assert.equal(await files.getByRole('button', { name: 'Download Hub Upload', exact: true }).count(), 0, 'No empty upload file for a failed group');
  await files.getByText('0 validated row(s); 1 unfinished or failed row(s) omitted from the upload.', { exact: true }).waitFor();
  const savedTemplatePromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download Hub Template', exact: true }).click();
  const savedTemplate = await savedTemplatePromise;
  const savedBook = new ExcelJS.Workbook();await savedBook.xlsx.load(await readFile((await savedTemplate.path())!));
  assert.deepEqual(hubHeaders.map((_, index) => savedBook.worksheets[0].getRow(1).getCell(index + 1).value), hubHeaders, 'Historical group schemas ignore later header edits');
  const failedShippingPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download Shipping File', exact: true }).click();
  const failedShipping = await failedShippingPromise;
  const failedShippingBook = new ExcelJS.Workbook();await failedShippingBook.xlsx.load(await readFile((await failedShipping.path())!));
  assert.equal(failedShippingBook.worksheets[0].rowCount, 3, 'Shipping includes both successful and failed Catalog SKUs');
  const hubItem = additionalRuns[multiJob.id].items[1];
  const hubInput = prepareCatalogInput(hubItem.snapshot, { attributeSet: 'Hub', rulesMarkdown: rules, headers: hubHeaders }, 40000);
  const hubGenerated = parseCatalogResponse({ choices: [{ message: { content: JSON.stringify({ row: { ...hubInput.template, name: 'Generated Hub' }, warnings: [] }) } }] }, hubInput);
  Object.assign(hubItem.result.catalog_state, hubGenerated, { status: 'completed', error: null });
  hubItem.status = 'completed'; additionalRuns[multiJob.id].status = 'completed';multiJob.status = 'completed';
  await files.getByRole('button', { name: 'Download Hub Upload', exact: true }).waitFor();
  assert.equal(await files.getByRole('button', { name: /Download .* Upload/ }).count(), 2);
  const hubUploadPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download Hub Upload', exact: true }).click();
  const hubUpload = await hubUploadPromise;
  const finalHubBook = new ExcelJS.Workbook();await finalHubBook.xlsx.load(await readFile((await hubUpload.path())!));
  assert.deepEqual(hubHeaders.map((_, index) => finalHubBook.worksheets[0].getRow(1).getCell(index + 1).value), hubHeaders);
  assert.equal(finalHubBook.worksheets[0].getRow(2).getCell(hubHeaders.indexOf('name') + 1).value, 'Generated Hub');
  await page.getByRole('button', { name: 'Close job details', exact: true }).click();
  await page.getByRole('checkbox', { name: `Select job ${multiJob.name}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `Select job ${catalogJob.name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Export Selected (2)', exact: true }).click();
  const selectedFiles = page.getByRole('region', { name: 'Selected Catalog files' });
  await selectedFiles.getByRole('button', { name: 'Download Hub Upload', exact: true }).waitFor();
  assert.equal(await selectedFiles.getByRole('button', { name: /Download .* Upload/ }).count(), 2);
  const selectedTVPromise = page.waitForEvent('download');
  await selectedFiles.getByRole('button', { name: 'Download TV Upload', exact: true }).click();
  const selectedTV = await selectedTVPromise;
  const selectedTVBook = new ExcelJS.Workbook();await selectedTVBook.xlsx.load(await readFile((await selectedTV.path())!));
  assert.equal(selectedTVBook.worksheets[0].rowCount, 3, 'Compatible TV rows combine separately from Hub rows');
  await mode.getByRole('button', { name: 'QA', exact: true }).click();
  assert.equal(await files.count(), 0, 'Mode switching closes Catalog files');
  assert.equal(await selectedFiles.count(), 0, 'Mode switching closes combined Catalog files');
  console.log('Catalog browser checks passed: input template download and upload, separate header editor, ordering, save errors, administrator permissions, mandatory inputs, case sensitivity, blank cells, text preservation, mode switching, jobs, and exact XLSX exports.');
} finally {
  await browser?.close(); await server.close();
}
