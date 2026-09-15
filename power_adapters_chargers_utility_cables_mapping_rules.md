# Elec-M&W-MA-Power Adapters / Chargers & Utility Cables Mapping Rules

Apply these rules only to the `Elec-M&W-MA-Power Adapters / Chargers & Utility Cables` attribute set.

## Validation Policy

* Use SAP as the primary source and scraped product content as the secondary source. When they conflict, use SAP and record the conflict in `source_notes.source_conflicts`.
* Report only issues proven by the supplied source. Do not infer connector standards, electrical ratings, charging protocols, transfer speeds, compatibility, safety protection, certifications, accessories, dimensions, weight, or country of origin.
* Accept equivalent unit conversions and harmless differences in case, spacing, punctuation, or standard abbreviations. Preserve official brand and model styling.
* Map severities consistently: CRITICAL = `critical` + `red`, MODERATE = `moderate` + `orange`, and MINOR = `minor` + `yellow`.
* Flag wrong identity, connector/interface, electrical rating, wattage, charging protocol, compatibility, battery, or safety information as CRITICAL. Flag important source-supported information missing from the upload as MODERATE unless a rule below requires CRITICAL. Flag presentation-only defects as MINOR.
* Do not flag a blank optional field when neither source supplies the value. Never invent a value for `suggested_fix`.

## Product Identity

* **`sku`**: MUST exactly match the SAP SKU, including separators and variant suffixes. Flag a missing or different SKU as CRITICAL.
* **`base_code`**: MUST match the SAP parent/base code and MUST NOT be replaced with the SKU, model, or EAN. Flag a mismatch as CRITICAL; do not flag when no base code exists in the source.
* **`attributes__lulu_ean`**: MUST exactly match the source barcode and preserve leading zeroes. It MUST contain only digits and use a valid GTIN length (8, 12, 13, or 14 digits). Flag a malformed value or source mismatch as CRITICAL. Do not calculate or invent a missing barcode.
* **`attributes__brand`**: MUST match the official manufacturer brand. Flag a different brand as CRITICAL and capitalization/styling only as MINOR.
* **`attributes__model`**: MUST exactly match the manufacturer model or part number, including suffixes that identify connector, wattage, plug, length, or color variants. Flag a missing or different source-supported model as CRITICAL.
* **`attributes__lulu_product_type`**: MUST identify the correct source-supported subtype, such as `Wall Charger`, `Car Charger`, `Power Adapter`, `Charging Cable`, `Data Cable`, or `USB Cable`. Flag an unrelated type or confusion between a charger, adapter, and cable as CRITICAL; flag an imprecise but related type as MODERATE.

## Customer-Facing Content

* **`name`** and **`attributes__product_title`**: MUST identify the same product and variant. For chargers/adapters, include supported brand, model, wattage, port/interface, and charger type; for cables, include connector endpoints, cable type, and length when available. Flag a wrong brand, model, subtype, connector, wattage, plug, or length variant as CRITICAL; flag a missing important identifier as MODERATE; flag grammar, repetition, or capitalization defects as MINOR.
* **`attributes__bullet_point_1`**, **`attributes__bullet_point_2`**, **`attributes__bullet_point_3`**, **`attributes__bullet_point_4`**, **`attributes__bullet_point_5`**, and **`attributes__bullet_point_6`**: Validate every populated bullet independently. Bullets SHOULD present distinct source-supported benefits such as interfaces, charging output, protocol, cable length, transfer speed, compatibility, design, or safety. Flag unsupported electrical, fast-charging, speed, compatibility, safety, certification, or performance claims as CRITICAL; flag repetition or omission of an important source-supported benefit as MODERATE; flag grammar or formatting defects as MINOR.
* **`attributes__product_description`**: MUST be readable, product-specific, and consistent with every structured field. Flag unsupported or contradictory technical/safety claims as CRITICAL, important omissions or generic/misleading copy as MODERATE, and spelling, grammar, or broken formatting as MINOR.
* **`attributes__keywords`**: MUST contain only relevant terms supported by the product identity, connectors, and functions. Flag keywords for a different brand, model, connector, charging protocol, wattage, or product type as CRITICAL; flag unsupported features or competitor-brand stuffing as MODERATE; flag repetition or delimiter/capitalization defects as MINOR.

## Pack, Contents, and Physical Details

* **`attributes__no_of_pieces`**: MUST state the number of sale units, not the number of ports, cable conductors, or included accessories. Accept a positive whole number only. Flag a source mismatch as MODERATE and an invalid format as MINOR.
* **`attributes__package_contents`** and **`attributes__in_the_box`**: MUST list only included items, such as the charger/adapter, detachable cable, plug head, or manual. Do not assume a charging cable or wall adapter is included. Flag a falsely included or omitted material accessory as CRITICAL; flag another source-supported omission or disagreement between these fields as MODERATE.
* **`attributes__pack`**: MUST express the source-supported selling quantity, such as `Single Pack` or `Pack of 2`, and agree with `attributes__no_of_pieces`. Flag a quantity contradiction as MODERATE and formatting only as MINOR.
* **`attributes__product_dimensions`**: MUST describe the main product, use a clear order such as `L × W × H`, and include units. For a cable, do not substitute cable length for three-dimensional product dimensions. Accept equivalent unit conversions. Flag a source mismatch as MODERATE and missing labels/units as MINOR.
* **`attributes__package_dimensions`**: MUST describe the retail package rather than the product and include dimension order and units. Accept equivalent conversions. Flag a source mismatch or confusion with product dimensions as MODERATE and formatting defects as MINOR.
* **`attributes__weight`**: MUST state product/net weight with a unit such as `g` or `kg`. It MUST NOT be copied from shipping weight unless the source states both are equal. Flag a source mismatch as MODERATE and missing units as MINOR.
* **`attributes__shipping_weight`**: MUST state packed/gross shipping weight with a unit and match SAP. Flag a source mismatch or confusion with product weight as MODERATE and missing units as MINOR.
* **`attributes__cable_length`**: MUST match the source length for an included, attached, or sold cable and include a unit such as `m`, `cm`, or `ft`. Accept equivalent conversions. Do not invent a length for a charger sold without a cable. Flag a wrong cable-length variant as CRITICAL, a missing source-supported length as MODERATE, and missing units as MINOR.
* **`attributes__color`**: MUST match the source color for the exact SKU. Flag a different color variant as CRITICAL; accept harmless equivalents such as `Grey` and `Gray`.
* **`attributes__design`**: MUST describe only verified form-factor details, such as wall, desktop, car, foldable plug, braided cable, right-angle connector, or retractable design. Flag a design that changes fit or use and contradicts the source as CRITICAL; flag unsupported cosmetic/construction claims as MODERATE.
* **`attributes__country_of_origin`**: MUST match the explicit country in SAP or scraped content. Flag a different or source-supported missing country as MODERATE. Do not infer origin from brand headquarters or seller location.

## Interfaces, Power, and Performance

* **`attributes__interfaces`**: MUST state the correct input/output connector and mains-plug standards, such as USB-A, USB-C, Micro-USB, Lightning, barrel connector, Type-G plug, or Type-C plug. Direction and gender MUST remain accurate when the source specifies them. Flag a wrong or unsupported interface as CRITICAL and missing source-supported detail as MODERATE.
* **`attributes__ports`**: MUST state the correct number and type of charger/adapter receptacles and agree with `attributes__interfaces`. Cable endpoints are not ports unless the source describes them that way. A cable with no receptacle may leave this field blank. Flag a wrong port count/type or internal contradiction as CRITICAL; flag an incomplete source-supported list as MODERATE.
* **`attributes__power`**: MUST preserve source-supported electrical input and output ratings, including voltage, current, frequency, AC/DC, per-port limits, and charging protocols such as USB PD, PPS, or Quick Charge. Do not treat plug shape as proof of voltage compatibility or protocol support. Flag any incorrect or unsafe rating/protocol as CRITICAL; flag missing important source-supported detail as MODERATE; flag unit formatting only as MINOR.
* **`attributes__wattage`**: MUST match the rated maximum output in watts and distinguish total charger output from per-port output and single-port from simultaneous-use limits. Do not add port maxima unless the source defines the sum as total output. Flag an overstated, understated, or wrong wattage variant as CRITICAL; flag missing source-supported wattage as MODERATE.
* **`attributes__data_transfer_speed`**: For data-capable cables/adapters, MUST match the source maximum rate and include units such as `Mbps` or `Gbps`; preserve qualifiers such as `up to`. Charging capability or a USB-C connector does not prove data support or speed. A power-only charger/cable may leave this field blank. Flag an unsupported or wrong data rate as CRITICAL, missing source-supported speed as MODERATE, and ambiguous units as MINOR.
* **`attributes__battery_capacity`**: Use only when the exact product contains an internal battery. MUST match the source value and unit, such as `mAh` or `Wh`; do not confuse capacity with wattage or charging output. For ordinary mains/car chargers, adapters, and passive cables, this field SHOULD be blank. Flag an invented battery/capacity or source mismatch as CRITICAL and a missing source-supported capacity as MODERATE.
* **`attributes__safety_features`**: MUST include only explicitly verified protections or certifications, such as overvoltage, overcurrent, short-circuit, overtemperature protection, or a named compliance mark. Do not infer protections from charger type, wattage, GaN construction, or generic wording. Flag a false, mismatched, or unsupported safety/certification claim as CRITICAL; flag an omitted source-supported protection as MODERATE.

## Compatibility and Optional Display Fields

* **`attributes__compatible_models`**: MUST list only manufacturer models or model families explicitly supported by the source. Preserve exclusions and required connector/power conditions. Flag an unsupported model, wrong model generation, or false universal claim as CRITICAL; flag an omitted material restriction as MODERATE.
* **`attributes__compatible_devices`**: MUST list only source-supported device classes and ecosystems. Compatibility requires the correct connector, voltage/current profile, charging protocol, and any stated device limitation; connector fit alone is insufficient. Flag an incompatible or unsupported device claim as CRITICAL and an omitted material condition as MODERATE.
* **`attributes__screen_size`**: Use only if the exact charger/adapter has an integrated screen. MUST match the sourced diagonal size and include a unit. Leave blank for products without a screen; do not confuse a connected device's screen size with the product. Flag an invented or wrong screen size as CRITICAL, a missing sourced value as MODERATE, and missing units as MINOR.
* **`attributes__display_type`**: Use only if the exact product has an integrated display and the source states its type, such as LCD or LED. Leave blank for products without a display. Flag an invented or wrong display type as CRITICAL and a missing source-supported type as MODERATE.

## Additional Information

* **`attributes__features`**: MUST contain only verified functions and construction details. Claims such as fast charging, GaN, smart power distribution, universal voltage, simultaneous maximum output, data sync, video support, tangle-free construction, fire resistance, or waterproofing require explicit source support. Flag unsupported technical/safety/performance claims as CRITICAL, an important source-supported omission as MODERATE, and wording defects as MINOR.
* **`attributes__other_information`**: Use only for relevant source-supported details without a dedicated field. It MUST NOT contradict or hide core interface, power, wattage, compatibility, or safety information. Flag factual contradictions as CRITICAL and irrelevant or duplicated content as MODERATE.
* **`note`**: Use for verified limitations, requirements, and customer-facing caveats, such as cable/adapter not included, shared output limits, charging-only cable, required protocol, or regional plug compatibility. Flag a missing caveat that materially affects safe use, compatibility, or expected performance as MODERATE; flag a note that contradicts the source as CRITICAL.

## Cross-Field Checks

* `name`, `attributes__product_title`, all bullet points, `attributes__product_description`, `attributes__features`, `attributes__other_information`, and `note` MUST agree with the structured identity, interface, power, compatibility, and safety fields.
* `attributes__interfaces` and `attributes__ports` MUST describe one consistent connector layout. `attributes__power` and `attributes__wattage` MUST describe one consistent electrical profile.
* `attributes__no_of_pieces`, `attributes__pack`, `attributes__package_contents`, and `attributes__in_the_box` MUST describe one consistent selling configuration.
* `attributes__weight` and `attributes__product_dimensions` MUST refer to the product; `attributes__shipping_weight` and `attributes__package_dimensions` MUST refer to the packed item.
* `attributes__compatible_models` and `attributes__compatible_devices` MUST be supported by the stated interfaces, electrical ratings, protocols, and source limitations.
