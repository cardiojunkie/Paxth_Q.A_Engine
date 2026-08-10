# TV Category Mapping Rules

These rules define how the QA LLM should validate uploaded attributes for Televisions against the Source Truth (SAP and Scraped Data).

## Critical Identification Attributes
These attributes are essential for product identity and must match the source exactly.
*   **`attributes__brand`**: MUST exactly match the brand found in the source truth (e.g., Samsung, LG, Sony). Flag as CRITICAL if mismatched.
*   **`attributes__model`**: MUST exactly match the manufacturer part number / model number. Flag as CRITICAL if mismatched.
*   **`attributes__lulu_ean`**: Must be a valid EAN/UPC barcode number. Flag as CRITICAL if missing or explicitly contradicting SAP data.
*   **`attributes__lulu_product_type`**: MUST be "Television" or "Smart TV" (or similar category standard).

## Core TV Specifications
These are the most important specs for a customer buying a TV.
*   **`attributes__screen_size`**: MUST be present (e.g., "55 Inch", "65 Inch"). Validate against source title/specs. Flag as CRITICAL if mismatched.
*   **`attributes__display_resolution`**: MUST be accurate (e.g., "4K UHD", "8K", "1080p FHD"). Match to source. Flag as CRITICAL if incorrect.
*   **`attributes__display_type`**: E.g., "OLED", "QLED", "LED", "Mini LED". Must not contradict source.
*   **`attributes__refresh_rate`**: E.g., "60Hz", "120Hz". If source claims 120Hz and upload says 60Hz (or vice-versa), flag as CRITICAL.

## Connectivity & Ports
*   **`attributes__hdmi`**: Total number of HDMI ports. If mentioned in source, upload MUST match.
*   **`attributes__usb`**: Total number of USB ports. Must match source if specified.
*   **`attributes__ports`**: General ports description. Ensure it doesn't contradict specific HDMI/USB fields.
*   **`attributes__wifi` & `attributes__bluetooth`**: Usually "Yes" or specific standard (e.g., "Wi-Fi 6", "Bluetooth 5.2"). Flag if omitted but clearly stated in source.

## Smart Features & Audio
*   **`attributes__os`**: Operating System (e.g., "Tizen", "webOS", "Android TV", "Google TV"). Flag as CRITICAL if mismatched.
*   **`attributes__audio` / `attributes__no_of_speakers`**: e.g., "20W", "2CH". Must align with source specs.
*   **`attributes__picture_processor`**: e.g., "Crystal Processor 4K", "a9 AI Processor". Important marketing spec, flag as MODERATE if missing when available in source.

## Content & Marketing
*   **`name` & `attributes__product_title`**: Must be well-formatted, customer-facing titles. Usually follows [Brand] + [Screen Size] + [Display Type] + [Resolution] + [Model Year/Series] (e.g., "Samsung 65 Inch 4K UHD Smart LED TV"). Flag as MODERATE if poorly formatted or missing key specs.
*   **`attributes__product_description`**: Must be a coherent paragraph describing the TV. Flag as MINOR if it contains formatting glitches or broken HTML.
*   **`attributes__bullet_point_1` to `attributes__bullet_point_6`**: Must highlight key selling points (Screen, Resolution, OS, Audio, Smart Features). Flag if redundant or containing technical jargon instead of benefits.

## Physical Specifications
*   **`attributes__color`**: Color of the bezel/stand.
*   **`attributes__product_dimensions` & `attributes__package_dimensions`**: Format usually LxWxH. Ensure units are present (cm, mm, inch).
*   **`attributes__weight` & `attributes__shipping_weight`**: Ensure units are present (kg, lbs).
*   **`attributes__in_the_box` / `attributes__package_contents`**: E.g., "TV, Remote, Power Cable, Stand, Manual".

## General Guidelines
*   **Empty Fields**: If the source truth contains information that belongs in an empty attribute field, flag it as MODERATE (Missing Information).
*   **Formatting**: Ensure no weird characters (e.g., , \n in plain text fields).
*   **Contradictions**: Any claim in the attributes that directly contradicts the scraped markdown or SAP data MUST be flagged as CRITICAL.
