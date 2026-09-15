# Elec-C&A-PCACC-USB Hubs Mapping Rules

Apply these rules only to the `Elec-C&A-PCACC-USB Hubs` attribute set.

## Validation Policy

* Use SAP as the primary source and scraped product content as the secondary source. When they conflict, use SAP and record the conflict in `source_notes.source_conflicts`.
* Report only issues proven by the supplied source. Do not infer a port, protocol, speed, wattage, compatibility claim, accessory, dimension, weight, or country of origin from general product knowledge.
* Accept equivalent unit conversions and harmless differences in case, spacing, punctuation, or standard abbreviations. Preserve the manufacturer's spelling for brand and model values.
* Map severities consistently: CRITICAL = `critical` + `red`, MODERATE = `moderate` + `orange`, and MINOR = `minor` + `yellow`.
* Flag a factual contradiction in identity or connectivity as CRITICAL. Flag important source-supported information missing from the upload as MODERATE unless a rule below explicitly requires CRITICAL. Flag presentation-only  defects as MINOR.
* Do not flag a blank optional field when neither source supplies the value. Never propose an invented value as `suggested_fix`.

## Product Identity

* **`sku`**: MUST exactly match the SKU in SAP, including letters, numbers, separators, and variant suffixes. Flag a missing or different SKU as CRITICAL.
* **`base_code`**: MUST match the SAP parent/base code and MUST NOT be replaced with the SKU, model, or EAN. Flag a mismatch as CRITICAL; do not flag when no base code exists in the source.
* **`attributes__lulu_ean`**: MUST exactly match the source barcode and preserve leading zeroes. It MUST contain only digits and use a valid GTIN length (8, 12, 13, or 14 digits). Flag a malformed value or source mismatch as CRITICAL. Do not calculate or invent a missing barcode.
* **`attributes__brand`**: MUST match the official manufacturer brand. Flag a different brand as CRITICAL; flag only capitalization or styling differences as MINOR.
* **`attributes__model`**: MUST exactly match the manufacturer model or part number, including suffixes that identify a variant. Flag a missing or different source-supported model as CRITICAL.
* **`attributes__lulu_product_type`**: MUST identify the item as a USB hub or a source-supported equivalent such as `USB-C Hub` or `USB-C Multiport Adapter`. Flag an unrelated type as CRITICAL and an imprecise but related type as MODERATE. Do not call a dedicated docking station, card reader, or single-purpose adapter a USB hub unless the source does.

## Customer-Facing Content

* **`name`** and **`attributes__product_title`**: MUST describe the same product and variant. Use a concise structure such as `[Brand] [Model] [Host Connector] [Port Count]-Port USB Hub [Key Supported Feature] [Color]`, including only source-supported facts. Flag the wrong brand, model, connector, port count, or variant as CRITICAL; flag a missing important identifier as MODERATE; flag grammar, duplicated words, or poor capitalization as MINOR.
* **`attributes__bullet_point_1`**, **`attributes__bullet_point_2`**, **`attributes__bullet_point_3`**, **`attributes__bullet_point_4`**, **`attributes__bullet_point_5`**, and **`attributes__bullet_point_6`**: Validate each populated bullet independently. Bullets SHOULD cover supported benefits such as port layout, transfer speed, display output, Ethernet, power delivery, build, or compatibility without repetition. Flag any unsupported port, speed, resolution, wattage, compatibility, safety, or performance claim as CRITICAL; flag repetition or omission of an important source-supported benefit as MODERATE; flag grammar or formatting defects as MINOR.
* **`attributes__product_description`**: MUST be readable, product-specific, and consistent with every structured attribute. Flag unsupported or contradictory technical claims as CRITICAL, important omissions or generic/misleading copy as MODERATE, and spelling, grammar, or broken formatting as MINOR.
* **`attributes__keywords`**: MUST contain only relevant search terms supported by the product identity and features. Flag keywords for a different brand, model, connector, protocol, or product type as CRITICAL; unsupported feature terms or competitor-brand stuffing as MODERATE; repeated terms or delimiter/capitalization defects as MINOR.

## Pack, Contents, and Physical Details

* **`attributes__color`**: MUST match the source color for the exact SKU. Flag a different color variant as CRITICAL and a harmless naming difference such as `Grey` versus `Gray` as no issue.
* **`attributes__no_of_pieces`**: MUST state the number of sale units, not the number of ports or accessories. Accept a positive whole number only. Flag a source mismatch as MODERATE and an invalid format as MINOR.
* **`attributes__pack`**: MUST express the source-supported selling quantity, such as `Single Pack` or `Pack of 2`, and agree with `attributes__no_of_pieces`. Flag a quantity contradiction as MODERATE and formatting only as MINOR.
* **`attributes__package_contents`** and **`attributes__in_the_box`**: MUST list only included items, such as the hub, detachable cable, power adapter, or manual. Do not assume a charger, cable, or adapter is included. Flag a falsely included or omitted material accessory as CRITICAL; flag other source-supported omissions or disagreement between these two fields as MODERATE.
* **`attributes__product_dimensions`**: MUST describe the hub itself, use a clear dimension order such as `L × W × H`, and include units. Accept mathematically equivalent unit conversions. Flag values that contradict the source as MODERATE and missing labels/units as MINOR.
* **`attributes__package_dimensions`**: MUST describe the retail package rather than the hub and include dimension order and units. Accept equivalent conversions. Flag a source mismatch or confusion with product dimensions as MODERATE and formatting defects as MINOR.
* **`attributes__weight`**: MUST be the product/net weight and include a unit such as `g` or `kg`. It MUST NOT be copied from shipping weight unless the source states both are equal. Flag a source mismatch as MODERATE and missing units as MINOR.
* **`attributes__shipping_weight`**: MUST be the packed/gross shipping weight, include a unit, and remain consistent with SAP. Flag a source mismatch or confusion with product weight as MODERATE and missing units as MINOR.
* **`attributes__country_of_origin`**: MUST match the explicit country in SAP or the scraped source. Flag a different country as MODERATE and a source-supported missing country as MODERATE. Do not infer origin from the brand's headquarters or seller location.

## Ports and Performance

* **`attributes__ports`**: MUST give an accurate summary of every source-supported port type and count, and MUST agree with `attributes__usb`, `attributes__hdmi`, and `attributes__ethernet`. Do not count the upstream host plug as a downstream port unless the source does. Flag any wrong port type/count or internal contradiction as CRITICAL; flag an incomplete source-supported list as MODERATE.
* **`attributes__usb`**: MUST distinguish the upstream host connector from downstream ports and preserve each source-supported connector type, count, and protocol (for example, USB-A, USB-C, USB 3.2 Gen 1). A USB-C connector alone does not prove USB4, Thunderbolt, video output, or power delivery. Flag a wrong count/type/protocol or unsupported capability as CRITICAL; flag missing source-supported detail as MODERATE.
* **`attributes__hdmi`**: MUST state the correct HDMI port count and only source-supported version, maximum resolution, and refresh rate. HDMI presence alone does not prove a version or `4K@60Hz`. Flag a wrong count or unsupported version/resolution/refresh claim as CRITICAL; flag missing available detail as MODERATE.
* **`attributes__ethernet`**: MUST state whether an Ethernet port exists and its source-supported maximum link speed, such as `1 Gbps`. Do not infer Gigabit Ethernet from the connector. Flag incorrect availability or speed as CRITICAL and missing source-supported speed as MODERATE.
* **`attributes__data_transfer_speed`**: MUST match the source maximum data rate and include correct units, normally `Mbps` or `Gbps`. Preserve qualifiers such as `up to`; do not add rates across ports or equate connector shape with speed. Flag an overstated or incorrect rate as CRITICAL, a missing source-supported rate as MODERATE, and ambiguous units or formatting as MINOR.
* **`attributes__power_delivery`**: MUST distinguish PD pass-through/input rating from the maximum power delivered to the host and state wattage only when sourced. PD support does not mean a charger is included. Flag unsupported PD, incorrect wattage/direction, or a false charger claim as CRITICAL; flag missing source-supported PD detail as MODERATE.
* **`attributes__compatible_devices`**: MUST contain only source-supported device, operating-system, and connection compatibility. A matching connector alone does not prove full compatibility; required USB-C DisplayPort Alt Mode, Thunderbolt, drivers, or operating-system limitations MUST be retained when stated. Flag an incompatible or unsupported compatibility claim as CRITICAL and an omitted material requirement as MODERATE.

## Additional Information

* **`attributes__features`**: MUST contain only verified functions and construction details. Claims such as plug-and-play, Thunderbolt, dual-display, driver-free operation, fast charging, simultaneous maximum output, or universal compatibility require explicit source support. Flag an unsupported technical/performance claim as CRITICAL, an important source-supported omission as MODERATE, and wording defects as MINOR.
* **`attributes__other_information`**: Use only for relevant source-supported details that do not have a dedicated field. It MUST NOT contradict structured attributes or hide core port, speed, PD, or compatibility facts. Flag factual contradictions as CRITICAL and irrelevant or duplicated content as MODERATE.
* **`attributes__note`**: Use for verified limitations, requirements, and customer-facing caveats, such as charger not included or video output requiring DisplayPort Alt Mode. Flag a missing caveat that would materially change compatibility or expected performance as MODERATE, and flag a note that contradicts the source as CRITICAL.

## Cross-Field Checks

* `name`, `attributes__product_title`, all bullet points, `attributes__product_description`, `attributes__features`, `attributes__other_information`, and `attributes__note` MUST agree with the structured identity and connectivity fields.
* `attributes__ports` MUST reconcile with the individual USB, HDMI, and Ethernet fields. Port count means the count explicitly defined by the source; do not silently include or exclude a captive host cable.
* `attributes__no_of_pieces`, `attributes__pack`, `attributes__package_contents`, and `attributes__in_the_box` MUST describe one consistent selling configuration.
* `attributes__weight` and `attributes__product_dimensions` MUST refer to the product; `attributes__shipping_weight` and `attributes__package_dimensions` MUST refer to the packed item.
