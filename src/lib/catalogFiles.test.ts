import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { SkuData } from '../hooks/useCatalogData';
import { CATALOG_PASS_THROUGH_HEADERS, prepareCatalogInput } from './catalogGeneration';
import { SHIPPING_REGIONS, shippingRegion, prepareShipping, prepareCatalogOutputs, catalogMappingFor, completedCatalogGroups, populateCatalogFile } from './catalogFiles';
import { validateCatalogImport, validateJob } from '../server/catalog';

const product: SkuData = { sku: '00042', attribute_set: 'TV', revision: 1, status: 'ready',
  source: { url: 'https://example.com/product' }, upload_attributes: {}, raw_row: {
    sku: '00042', base_code: '00001', attributes__region: 'UAE', attributes__lulu_ean: '0001234567890',
    attributes__shipping_weight: '', attributes__brand: ' TestBrand ', attributes__lulu_product_type: 'Accessory',
    attribute__shipping_attribute: ' 001 ', attribute__shipment_type: 'Express',
    attribute__common_item_whippy: '0007', attribute__fallback: '', attributes__erp_shipping_attribute_kwt: 'FORGED',
  } };
const fixed = ['sku', 'base_code', 'attributes__erp_shipping_attribute', 'attributes__erp_shipping_attribute_kwt',
  'attributes__erp_shipping_attribute_qtr', 'attributes__erp_shipping_attribute_oman', 'attributes__erp_shipping_attribute_ksa',
  'attributes__erp_shipping_attribute_bahrain', 'attributes__erp_shipment_type_uae', 'attributes__erp_shipment_type_kwt',
  'attributes__erp_shipment_type_qtr', 'attributes__erp_shipment_type_oman', 'attributes__erp_shipment_type_ksa', 'attributes__erp_shipment_type_bahrain'];
const fallbacks = ['fallback_uae', 'fallback_kuwait', 'fallback_qatar', 'fallback_oman', 'fallback_ksa', 'fallback_bahrain'];
for (const [index, region] of SHIPPING_REGIONS.entries()) {
  const original = { ...product, raw_row: { ...product.raw_row, attributes__region: ` ${region.toUpperCase()} ` } };
  const shipping = prepareShipping([original]);
  assert.deepEqual(shipping.headers, [...fixed, `attributes__common_item_whippy_${region}`, fallbacks[index]]);
  assert.equal(shipping.headers.length, 16);
  assert.equal(shipping.region, region);
  assert.equal(shipping.rows[0].sku, '00042');
  assert.equal(shipping.rows[0].base_code, '00001');
  assert.equal(shipping.rows[0][shipping.headers[2 + index]], ' 001 ');
  assert.equal(shipping.rows[0][shipping.headers[8 + index]], 'Express');
  assert.equal(shipping.rows[0][shipping.headers[14]], '0007');
  assert.equal(shipping.rows[0][shipping.headers[15]], '');
  for (let other = 0; other < 6; other++) if (other !== index) {
    assert.equal(shipping.rows[0][shipping.headers[2 + other]], 'Courier delivery');
    assert.equal(shipping.rows[0][shipping.headers[8 + other]], 'Scheduled');
  }
  const book = new ExcelJS.Workbook(); populateCatalogFile(book.addWorksheet('Shipping'), shipping);
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = reopened.worksheets[0];
  assert.equal(reopened.worksheets.length, 1); assert.equal(sheet.name, 'Shipping');
  assert.equal(sheet.columnCount, 16); assert.equal(sheet.rowCount, 2);
  assert.deepEqual(shipping.headers.map((_, column) => sheet.getRow(1).getCell(column + 1).value), shipping.headers);
  assert.equal(sheet.getRow(2).getCell(2).value, '00001');
  for (const column of sheet.columns) { assert.equal(column.numFmt, '@'); assert.ok(column.width! >= 20); }
  assert.equal(sheet.getRow(1).font.bold, true);
}
const empty = prepareShipping([{ ...product, raw_row: { ...product.raw_row, attribute__shipping_attribute: '', attribute__shipment_type: '', attribute__common_item_whippy: '' } }]);
assert.equal(empty.rows[0].attributes__erp_shipping_attribute, 'Courier delivery');
assert.equal(empty.rows[0].attributes__erp_shipment_type_uae, 'Scheduled');
assert.equal(empty.rows[0].attributes__common_item_whippy_uae, '');
for (const region of ['', 'unknown', 'kuwait']) assert.throws(() => shippingRegion([{ ...product, raw_row: { ...product.raw_row, attributes__region: region } }]), /Correct these SKUs/);
assert.throws(() => shippingRegion([product, { ...product, sku: 'other', raw_row: { ...product.raw_row, attributes__region: 'QTR' } }]), /one common region/);
const headers = [...CATALOG_PASS_THROUGH_HEADERS, 'name'];
const mappings = [{ attributeSet: 'TV', headers, rulesMarkdown: 'name: use evidence' },
  { attributeSet: 'Hub', headers: [...headers].reverse(), rulesMarkdown: 'name: use evidence' }];
const second = { ...product, sku: '00043', attribute_set: 'Hub', raw_row: { ...product.raw_row, sku: '00043' } };
const third = { ...product, sku: '00044', raw_row: { ...product.raw_row, sku: '00044' } };
const outputs = prepareCatalogOutputs([product, second, third], mappings);
assert.deepEqual(outputs.groups.map(group => group.attributeSet), ['TV', 'Hub']);
assert.deepEqual(outputs.groups[0].rows.map(row => row.sku), ['00042', '00044']);
assert.deepEqual(outputs.shipping!.rows.map(row => row.sku), ['00042', '00043', '00044']);
assert.equal(outputs.groups[0].rows[0].attributes__brand, ' TestBrand ');
assert.equal(outputs.groups[0].rows[0].attributes__shipping_weight, '');
assert.equal(outputs.groups[0].rows[0].name, '');
assert.throws(() => prepareCatalogInput(product, mappings[0], 40000), /no usable SAP/, 'URL-only creation does not require scraped evidence');
assert.deepEqual(catalogMappingFor({ catalogMapping: mappings[0] }, 'TV'), mappings[0]);
assert.deepEqual(catalogMappingFor({ catalogMappings: mappings }, 'Hub'), mappings[1]);
assert.throws(() => catalogMappingFor({ catalogMappings: mappings }, 'Missing'));
const completed = { ...product, catalog_state: { status: 'completed' as const, revision: 1, jobId: 'job', headers, row: outputs.groups[0].rows[0], warnings: [] } };
const final = completedCatalogGroups([completed, second, third], outputs.groups);
assert.equal(final[0].rows.length, 1); assert.equal(final[1].rows.length, 0);
assert.throws(() => completedCatalogGroups([completed], [{ ...outputs.groups[0], headers: [...headers].reverse() }]), /identical saved header order/);
const legacy = prepareCatalogOutputs([{ ...product, raw_row: {} }], mappings.slice(0, 1), true);
assert.equal(legacy.shipping, null); assert.match(legacy.shippingError!, /unavailable/); assert.equal(legacy.groups.length, 1);
assert.throws(() => prepareCatalogOutputs([{ ...product, raw_row: {} }], mappings));
assert.equal(product.raw_row.attributes__region, 'UAE');
for (const key of ['catalog_outputs', 'catalogOutputs']) {
  assert.throws(() => validateCatalogImport([{ ...product, [key]: outputs }]), /written by the server/);
  assert.throws(() => validateCatalogImport([{ ...product, raw_row: { ...product.raw_row, [key]: outputs } }]), /written by the server/);
  assert.throws(() => validateJob({ id: 'job', name: 'Job', skus: ['00042'], [key]: outputs }), /written by the server/);
}
console.log('Catalog files checks passed: six regions, exact shipping columns, defaults, text, grouping, URL-only templates, legacy compatibility, and XLSX round trips.');
