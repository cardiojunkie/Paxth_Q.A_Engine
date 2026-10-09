import type { SkuData } from '../hooks/useCatalogData';
import type { CatalogFileGroup, CatalogOutputs } from '../types';
import { CatalogMapping, catalogPassThroughValue, hasCompletedCatalog, prepareCatalogTemplate } from './catalogGeneration';
export { populateCatalogFile } from './catalogGeneration';

export const SHIPPING_REGIONS = ['uae', 'kwt', 'qtr', 'oman', 'ksa', 'bahrain'] as const;
const fallbackNames = ['uae', 'kuwait', 'qatar', 'oman', 'ksa', 'bahrain'];
const shippingHeader = (region: string) => `attributes__erp_shipping_attribute${region === 'uae' ? '' : `_${region}`}`;
const shipmentHeader = (region: string) => `attributes__erp_shipment_type_${region}`;

export function shippingRegion(skus: SkuData[]): string {
  const regions = skus.map(sku => String(sku.raw_row.attributes__region ?? '').trim().toLowerCase());
  const invalid = skus.filter((_, index) => !(SHIPPING_REGIONS as readonly string[]).includes(regions[index]));
  if (invalid.length) throw new Error(`Catalog shipping requires attributes__region to be UAE, KWT, QTR, OMAN, KSA, or BAHRAIN. Correct these SKUs: ${invalid.map(sku => sku.sku).join(', ')}.`);
  if (!regions.length || new Set(regions).size !== 1) throw new Error('Catalog jobs require one common region. Create separate jobs for different regions.');
  return regions[0];
}

export function prepareShipping(skus: SkuData[]): NonNullable<CatalogOutputs['shipping']> {
  const region = shippingRegion(skus);
  const whippy = `attributes__common_item_whippy_${region}`;
  const fallback = `fallback_${fallbackNames[SHIPPING_REGIONS.indexOf(region as typeof SHIPPING_REGIONS[number])]}`;
  const headers = ['sku', 'base_code', ...SHIPPING_REGIONS.map(shippingHeader), ...SHIPPING_REGIONS.map(shipmentHeader), whippy, fallback];
  const rows = skus.map(sku => Object.fromEntries(headers.map(header => {
    let value = '';
    if (header === 'sku' || header === 'base_code') value = catalogPassThroughValue(sku, header);
    else if (header === whippy) value = String(sku.raw_row.attribute__common_item_whippy ?? '');
    else if (header === fallback) value = String(sku.raw_row.attribute__fallback ?? '');
    else if (header === shippingHeader(region)) value = String(sku.raw_row.attribute__shipping_attribute ?? '') || 'Courier delivery';
    else if (header === shipmentHeader(region)) value = String(sku.raw_row.attribute__shipment_type ?? '') || 'Scheduled';
    else value = header.startsWith('attributes__erp_shipping_attribute') ? 'Courier delivery' : 'Scheduled';
    return [header, value];
  })));
  return { region, headers, rows };
}

export function prepareCatalogOutputs(skus: SkuData[], mappings: CatalogMapping[], allowUnavailableShipping = false): CatalogOutputs {
  const groups = mappings.map(mapping => ({ attributeSet: mapping.attributeSet, headers: [...mapping.headers],
    rows: skus.filter(sku => sku.attribute_set === mapping.attributeSet).map(sku => prepareCatalogTemplate(sku, mapping).template) }));
  try { return { groups, shipping: prepareShipping(skus) }; }
  catch (error) {
    if (!allowUnavailableShipping) throw error;
    return { groups, shipping: null, shippingError: `Shipping file unavailable: ${(error as Error).message}` };
  }
}

// Historical runs admitted before grouped mappings still use their singleton snapshot.
export function catalogMappings(configuration: { catalogMappings?: CatalogMapping[]; catalogMapping?: CatalogMapping }): CatalogMapping[] {
  return configuration.catalogMappings || (configuration.catalogMapping ? [configuration.catalogMapping] : []);
}

export function catalogMappingFor(configuration: Parameters<typeof catalogMappings>[0], attributeSet?: string): CatalogMapping {
  const mapping = catalogMappings(configuration).find(mapping => mapping.attributeSet === attributeSet);
  if (!mapping) throw new Error(`No saved Catalog mapping for attribute set ${attributeSet || '(missing)'}.`);
  return mapping;
}

export function completedCatalogGroups(skus: SkuData[], groups: Pick<CatalogFileGroup, 'attributeSet' | 'headers'>[]): CatalogFileGroup[] {
  return groups.map(group => {
    const completed = skus.filter(sku => sku.attribute_set === group.attributeSet && hasCompletedCatalog(sku));
    return { ...group, rows: completed.map(sku => {
      if (JSON.stringify(sku.catalog_state!.headers) !== JSON.stringify(group.headers)) throw new Error('Catalog jobs must have identical saved header order to export together.');
      return sku.catalog_state!.row!;
    }), cellWarnings: Object.fromEntries(completed.map(sku => [sku.catalog_state!.row!.sku, sku.catalog_state!.cellWarnings || []])) };
  });
}
