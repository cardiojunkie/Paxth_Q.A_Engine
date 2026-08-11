import assert from "node:assert/strict";
import { isCompleteWebsiteDomain, normalizeWebsite } from "./siteSelectorWebsite.ts";

assert.equal(normalizeWebsite("https://www.Example.com/products/1"), "example.com");
assert.deepEqual(
  ["example.com", "www.tcl.com", "https://shop.tcl.com/product", "www.tcl", "tcl", "bad_domain.com"]
    .map(isCompleteWebsiteDomain),
  [true, true, true, false, false, false],
);
