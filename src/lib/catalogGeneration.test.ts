import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { CATALOG_PASS_THROUGH_HEADERS, migrateCatalogProductTypeHeader, catalogPassThroughValue, validateCatalogHeaders, parseCatalogHeaders, getCatalogMapping, prepareCatalogInput, parseCatalogResponse, hasCompletedCatalog, catalogStatus, populateCatalogWorksheet } from './catalogGeneration';
import { mapCatalogRow, mapJobRow, validateCatalogImport, validateJob } from '../server/catalog';
import { unreviewedRunSnapshot } from './jobRunState';
import type { SkuData } from '../hooks/useCatalogData';

const headers = ['sku', 'base_code', 'attribute_set', 'attributes__lulu_ean', 'attributes__Shipping_Attribute',
  'attributes__Shipment_Type', 'attributes__Common_Item_Whippy', 'attributes__fallback', 'name', 'attributes__color',
  'attributes__shipping_weight', 'attributes__brand', 'attributes__lulu_product_type'];
const rules = '# Example\n\nname: use the sourced brand and model; example: TestBrand USB Hub.\nattributes__color: leave blank if unsourced.\nattributes__fallback: default to No when empty.';
const legacyRules = `## Catalog Headers\n\n\`\`\`text\n${headers.join('\n')}\n\`\`\`\n\n${rules}`;
assert.deepEqual(parseCatalogHeaders(legacyRules), headers);
assert.deepEqual(parseCatalogHeaders(legacyRules.replaceAll('\n', '\r\n')), headers);
const legacyHeaders = headers.map(header => header === 'attributes__lulu_product_type' ? 'attributes__product_type' : header);
assert.deepEqual(migrateCatalogProductTypeHeader(legacyHeaders), headers, 'The rename preserves output column order');
assert.deepEqual(migrateCatalogProductTypeHeader(['attributes__product_type', ...headers]), headers, 'An existing canonical header keeps its position');
assert.deepEqual(migrateCatalogProductTypeHeader([...headers, 'attributes__product_type']), headers);
assert.deepEqual(migrateCatalogProductTypeHeader([]), []);
assert.deepEqual(parseCatalogHeaders(legacyRules.replace('attributes__lulu_product_type', 'attributes__product_type')), headers);
for (const invalid of ['', '## Catalog Headers\nsku', legacyRules.replace('```text', '```json'),
  legacyRules.replace('sku\nbase_code', 'sku\nsku'), legacyRules.replace('sku\nbase_code', 'SKU\nbase_code'),
  legacyRules.replace('sku\nbase_code', 'sku\n\nbase_code'), legacyRules.replace('sku\nbase_code', 'sku\n base_code'), legacyRules + '\n' + legacyRules]) {
  assert.throws(() => parseCatalogHeaders(invalid));
}
validateCatalogHeaders([]); validateCatalogHeaders(headers);
assert.throws(() => validateCatalogHeaders(legacyHeaders), /attributes__lulu_product_type/, 'New output lists require the canonical name');
assert.throws(() => validateCatalogHeaders([...headers, 'attributes__product_type']), /Rename/, 'Deprecated output headers cannot be reintroduced after migration');
for (const invalid of [null, {}, 'sku', ['sku'], [...headers, 'sku'], [...headers, ''], [...headers, ' padded'], [...headers, 5], [...headers, 'tab\t']]) assert.throws(() => validateCatalogHeaders(invalid));
for (const header of CATALOG_PASS_THROUGH_HEADERS) assert.throws(() => validateCatalogHeaders(headers.filter(value => value !== header)));
const set = { name: ' tv ', rulesMarkdown: rules, catalogHeaders: headers };
const mapping = getCatalogMapping('TV', [set]);
assert.deepEqual(mapping.headers, headers);
assert.deepEqual(getCatalogMapping('TV', [{ ...set, rulesMarkdown: legacyRules, catalogHeaders: [...headers].reverse() }]).headers, [...headers].reverse(), 'Saved headers override any header block in Markdown');
assert.throws(() => getCatalogMapping('TV', [{ ...set, catalogHeaders: [] }]), /Catalog Output Headers/);
assert.throws(() => getCatalogMapping('TV', [{ ...set, rulesMarkdown: ' \n ' }]), /Mapping Rules/);
assert.throws(() => getCatalogMapping('TV', []));
assert.throws(() => getCatalogMapping('TV', [set, { ...set, name: 'TV' }]));

const sku: SkuData = { sku: '00042', attribute_set: 'TV', revision: 3, status: 'ready',
  raw_row: { sku: '00042', base_code: '00001', attributes__lulu_ean: '0001234567890' },
  upload_attributes: { lulu_ean: '0001234567890', Shipping_Attribute: '001', Shipment_Type: 'Normal', Common_Item_Whippy: 'No' },
  source: { sap: 'Brand: TestBrand; Model: USB Hub', url: 'https://example.com/product' } };
const original = structuredClone(sku);
const input = prepareCatalogInput(sku, mapping, 40000);
assert.equal(input.template.attributes__lulu_ean, '0001234567890');
assert.equal(input.template.attributes__Shipping_Attribute, '001');
assert.equal(input.template.base_code, '00001');
assert.equal(input.template.name, '');
assert.match(input.messages[0].content, /examples illustrate formatting, never product facts/);
assert.match(input.messages[0].content, /SAP is the primary factual authority/);
assert.match(input.messages[0].content, /Review both supplied and generated cells/);
assert.match(input.messages[0].content, /without replacing them/);
const response = (value: unknown, extras: any = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) }, ...extras }] });
const row = { ...input.template, name: 'TestBrand USB Hub', attributes__fallback: 'No', attributes__lulu_ean: 'FORGED' };
const output = parseCatalogResponse(response({ row, warnings: [], cellWarnings: [] }), input);
const forgedPassThrough = { ...input.template, ...Object.fromEntries(CATALOG_PASS_THROUGH_HEADERS.map(header => [header, 'MODEL CHANGE'])) };
const protectedOutput = parseCatalogResponse(response({ row: forgedPassThrough, warnings: [], cellWarnings: [] }), input);
for (const header of CATALOG_PASS_THROUGH_HEADERS) assert.equal(protectedOutput.row[header], input.template[header]);
assert.equal(protectedOutput.row.attributes__brand, '', 'Blank pass-through values cannot be generated from evidence');
assert.ok(protectedOutput.warnings.some(warning => warning.includes('Blank pass-through value for attributes__brand')));
assert.equal(protectedOutput.row.attributes__lulu_product_type, '', 'Blank product types remain blank');
const canonicalSku = { ...sku, raw_row: { ...sku.raw_row, attributes__lulu_product_type: ' 000Accessory ', attributes__product_type: 'Obsolete type' } };
const canonicalInput = prepareCatalogInput(canonicalSku, mapping, 40000);
assert.equal(canonicalInput.template.attributes__lulu_product_type, ' 000Accessory ');
assert.ok(canonicalInput.messages[0].content.includes('attributes__lulu_product_type'));
assert.equal(parseCatalogResponse(response({ row: { ...canonicalInput.template, attributes__lulu_product_type: 'MODEL CHANGE' }, warnings: [], cellWarnings: [] }), canonicalInput).row.attributes__lulu_product_type, ' 000Accessory ');
assert.equal(catalogPassThroughValue({ ...canonicalSku, raw_row: { ...canonicalSku.raw_row, attributes__lulu_product_type: '' } }, 'attributes__lulu_product_type'), '', 'Canonical blank values take precedence over old values');
assert.equal(catalogPassThroughValue({ ...canonicalSku, raw_row: { ...canonicalSku.raw_row, attributes__lulu_product_type: null } }, 'attributes__lulu_product_type'), '', 'Explicit canonical null cells stay blank');
const legacySku = { ...sku, raw_row: { ...sku.raw_row, attributes__product_type: ' 000Legacy Hub ' } };
assert.equal(prepareCatalogInput(legacySku, mapping, 40000).template.attributes__lulu_product_type, ' 000Legacy Hub ', 'Earlier uploads retain their original pass-through value');
assert.equal(catalogPassThroughValue({ ...sku, raw_row: { ...sku.raw_row, attributes__product_type: null }, upload_attributes: { ...sku.upload_attributes, product_type: 'Conflicting value' } }, 'attributes__lulu_product_type'), '', 'Legacy null cells also remain blank');
assert.equal(catalogPassThroughValue({ ...sku, upload_attributes: { ...sku.upload_attributes, product_type: 'Legacy attribute' } }, 'attributes__lulu_product_type'), 'Legacy attribute');
assert.equal(catalogPassThroughValue({ ...legacySku, upload_attributes: { ...sku.upload_attributes, lulu_product_type: 'Current attribute' } }, 'attributes__lulu_product_type'), 'Current attribute');
const legacyRunInput = prepareCatalogInput({ ...legacySku, raw_row: { ...legacySku.raw_row, attributes__product_type: '' } }, { ...mapping, headers: legacyHeaders }, 40000);
assert.equal(parseCatalogResponse(response({ row: { ...legacyRunInput.template, attributes__product_type: 'MODEL CHANGE' }, warnings: [], cellWarnings: [] }), legacyRunInput).row.attributes__product_type, '', 'Admitted legacy runs preserve blank product-type values');
assert.deepEqual(legacySku.raw_row, { ...sku.raw_row, attributes__product_type: ' 000Legacy Hub ' }, 'Compatibility never rewrites uploaded rows');
const unusualInput = prepareCatalogInput(sku, { ...mapping, headers: [...headers, 'constructor', '__proto__', 'toString'] }, 40000);
for (const header of ['constructor', '__proto__', 'toString']) assert.equal(unusualInput.template[header], '');
const unusualOutput = parseCatalogResponse(response({ row: { ...unusualInput.template, constructor: 'Constructor', ['__proto__']: 'Prototype', toString: 'String' }, warnings: [], cellWarnings: [] }), unusualInput);
assert.equal(unusualOutput.row.constructor, 'Constructor');
assert.equal(output.row.attributes__lulu_ean, '0001234567890', 'Copied values are enforced by the application');
assert.equal(output.row.attributes__fallback, 'No');
assert.equal(output.row.attributes__color, '');
assert.ok(output.warnings.some(warning => warning.includes('attributes__color')));
assert.ok(output.cellWarnings.some(warning => warning.header === 'attributes__color' && warning.message.includes('Missing value')));
assert.ok(protectedOutput.cellWarnings.some(warning => warning.header === 'attributes__brand' && warning.message.includes('preserved from the input')));
assert.deepEqual(sku, original);
for (const bad of [{ row: { sku: '00042' }, warnings: [], cellWarnings: [] }, { row: { ...row, extra: 'oops' }, warnings: [], cellWarnings: [] },
  { row: { ...row, name: 12 }, warnings: [], cellWarnings: [] }, { row, warnings: '' }, { row, warnings: [5] },
  { row, warnings: [], cellWarnings: [], qa_result: {} }, { row: null, warnings: [], cellWarnings: [] }]) {
  assert.throws(() => parseCatalogResponse(response(bad), input));
}
for (const cellWarnings of [undefined, null, {}, ['message'], [null], [{ header: 'unknown', message: 'Wrong column' }],
  [{ header: 'name', message: ' ' }], [{ header: 'name', message: 5 }], [{ header: 'name', message: 'Review', extra: true }],
  [{ header: 'constructor', message: 'Not an own template header' }]]) {
  assert.throws(() => parseCatalogResponse(response({ row, warnings: [], cellWarnings }), input), /incomplete catalog row/);
}
for (const extras of [{ finish_reason: 'length' }, { finish_reason: 'content_filter' }, { message: { refusal: 'Refused' } }]) {
  assert.throws(() => parseCatalogResponse(response({ row, warnings: [], cellWarnings: [] }, extras), input));
}
assert.throws(() => parseCatalogResponse({ choices: [{ message: { content: '```json\n{}\n```' } }] }, input));
assert.throws(() => prepareCatalogInput({ ...sku, source: {} }, mapping, 40000));
assert.ok(prepareCatalogInput({ ...sku, scraped_markdown: 'Long web evidence', scrape_metadata: { method: 'manual', requestedUrl: null, finalUrl: null, capturedAt: null } }, mapping, 4).warnings.length);

const operationalSku = { ...sku, raw_row: { ...sku.raw_row, source__attribute_set: 'TV', attributes__attribute_set: 'Uploaded category',
  attribute__shipping_attribute: '001', attribute__shipment_type: 'Normal', attribute__common_item_whippy: 'No', attribute__fallback: '' },
  upload_attributes: { ...sku.upload_attributes, attribute_set: 'Uploaded category', shipping_attribute: '001', shipment_type: 'Normal', common_item_whippy: 'No' } };
const operationalMapping = { ...mapping, headers: Object.keys(operationalSku.raw_row) };
const operationalInput = prepareCatalogInput(operationalSku, operationalMapping, 40000);
assert.equal(operationalInput.template.source__attribute_set, 'TV');
assert.equal(operationalInput.template.attributes__attribute_set, 'TV');
assert.equal(operationalInput.template.attribute__shipping_attribute, '001');
assert.equal(operationalInput.template.attribute__shipment_type, 'Normal');
assert.equal(operationalInput.template.attribute__common_item_whippy, 'No');
assert.equal(operationalInput.template.attribute__fallback, '');
assert.equal(prepareCatalogInput({ ...operationalSku, upload_attributes: { ...operationalSku.upload_attributes, shipping_attribute: '002' } }, operationalMapping, 40000).template.attribute__shipping_attribute, '002', 'Shared evidence edits also apply to singular attribute headers');
const operationalOutput = parseCatalogResponse(response({ row: { ...operationalInput.template, attribute__shipping_attribute: 'MODEL CHANGE', attribute__fallback: 'No' }, warnings: [], cellWarnings: [] }), operationalInput);
assert.equal(operationalOutput.row.attribute__shipping_attribute, '001');
assert.equal(operationalOutput.row.attribute__fallback, 'No');
const overlappingSku = { ...operationalSku, raw_row: { ...operationalSku.raw_row, attribute__fallback: 'No', attributes__fallback: 'Yes' },
  upload_attributes: { ...operationalSku.upload_attributes, fallback: 'Yes' } };
const overlappingInput = prepareCatalogInput(overlappingSku, { ...mapping, headers: ['sku', 'attribute__fallback', 'attributes__fallback'] }, 40000);
assert.equal(overlappingInput.template.attribute__fallback, 'No');
assert.equal(overlappingInput.template.attributes__fallback, 'Yes', 'Extra columns with another prefix retain their own supplied values');

const state = { ...output, status: 'completed' as const, headers, revision: 3, jobId: 'catalog-job' };
const completed = { ...sku, catalog_state: state };
assert.equal(hasCompletedCatalog(completed), true);
assert.equal(catalogStatus(completed), 'completed');
assert.equal(hasCompletedCatalog({ ...completed, revision: 4 }), false);
assert.equal(catalogStatus({ ...completed, revision: 4 }), 'ready');
assert.equal(mapCatalogRow({ ...sku, catalog_state: state }).catalog_state, state);
assert.equal(mapCatalogRow({ ...sku, revision: 4, catalog_state: state }).catalog_state, null);
assert.equal(Object.hasOwn(unreviewedRunSnapshot(completed), 'catalog_state'), false);
assert.throws(() => validateCatalogImport([{ ...sku, catalog_state: state }]));
assert.throws(() => validateCatalogImport([{ ...sku, raw_row: { ...sku.raw_row, catalog_state: state } }]));
assert.equal(mapJobRow({ id: 'old', skus: [] }).jobType, 'qa');
assert.equal(mapJobRow({ id: 'new', skus: [], job_type: 'catalog' }).jobType, 'catalog');
const job = { id: 'job', name: 'Job', skus: ['00042'] };
validateJob(job); validateJob({ ...job, jobType: 'catalog' });
assert.throws(() => validateJob({ ...job, jobType: 'invalid' }));

const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet('Catalog');
assert.equal(populateCatalogWorksheet(sheet, [state, { ...state, status: 'failed', row: undefined }]), 1);
const loaded = new ExcelJS.Workbook();
await loaded.xlsx.load(await book.xlsx.writeBuffer());
assert.deepEqual(headers.map((_, index) => loaded.worksheets[0].getRow(1).getCell(index + 1).value), headers);
assert.equal(loaded.worksheets[0].getRow(2).getCell(4).value, '0001234567890');
assert.equal(loaded.worksheets[0].columnCount, headers.length);
assert.equal(loaded.worksheets[0].rowCount, 2);
assert.throws(() => populateCatalogWorksheet(book.addWorksheet('Different'), [state, { ...state, headers: [...headers].reverse() }]));
assert.throws(() => populateCatalogWorksheet(book.addWorksheet('Empty'), []));

const conflictSku = { ...sku, raw_row: { ...sku.raw_row, name: '  Uploaded العربية TV  ', attributes__brand: 'UploadedBrand' },
  source: { sap: 'Brand: Samsung; Model: QN90F; Colour: Black', url: 'https://example.com/product' },
  scraped_markdown: '# Samsung QN90F\nColour: White\nPrice: AED 4,999',
  scrape_metadata: { method: 'manual' as const, requestedUrl: null, finalUrl: null, capturedAt: null } };
const conflictInput = prepareCatalogInput(conflictSku, mapping, 40000);
assert.equal(JSON.parse(conflictInput.messages[1].content).scraped_markdown, conflictSku.scraped_markdown);
const nameWarning = { header: 'name', message: 'Uploaded name "Uploaded العربية TV" differs from SAP model QN90F; review product identity. ' };
const secondNameWarning = { header: 'name', message: 'The mapping requires the sourced brand in the name; the uploaded name omits Samsung.' };
const brandWarning = { header: 'attributes__brand', message: 'UploadedBrand differs from SAP brand Samsung; preserve the uploaded value for review.' };
const conflictOutput = parseCatalogResponse(response({ row: { ...conflictInput.template, name: 'Samsung QN90F', attributes__brand: 'Samsung' },
  warnings: ['Check the source variant.'], cellWarnings: [nameWarning, nameWarning, secondNameWarning, brandWarning] }), conflictInput);
assert.equal(conflictOutput.row.name, '  Uploaded العربية TV  ');
assert.equal(conflictOutput.row.attributes__brand, 'UploadedBrand');
assert.equal(conflictOutput.cellWarnings.filter(warning => warning.header === 'name').length, 2);
assert.ok(conflictOutput.warnings.includes(nameWarning.message.trim()));
const conflictBook = new ExcelJS.Workbook();
populateCatalogWorksheet(conflictBook.addWorksheet('Catalog'), [{ ...state, ...conflictOutput }]);
const conflictLoaded = new ExcelJS.Workbook(); await conflictLoaded.xlsx.load(await conflictBook.xlsx.writeBuffer());
const conflictSheet = conflictLoaded.worksheets[0];
const flaggedName = conflictSheet.getCell(2, headers.indexOf('name') + 1);
assert.equal(flaggedName.value, conflictSku.raw_row.name);
assert.equal((flaggedName.fill as ExcelJS.FillPattern).fgColor?.argb, 'FFFFE5B4');
assert.match(JSON.stringify(flaggedName.note), /SAP model QN90F/);
assert.match(JSON.stringify(flaggedName.note), /mapping requires/);
assert.equal(conflictSheet.getCell(2, 4).value, '0001234567890');
assert.equal(conflictSheet.columnCount, headers.length);
const legacyState = { ...state }; delete (legacyState as Partial<typeof state>).cellWarnings;
const legacySheet = conflictBook.addWorksheet('Legacy'); populateCatalogWorksheet(legacySheet, [legacyState]);
assert.equal(legacySheet.getCell(2, headers.indexOf('name') + 1).note, undefined);
console.log('Catalog generation checks passed: mapping contract, copied values, response validation, stale results, trust boundaries, and exact XLSX exports.');
