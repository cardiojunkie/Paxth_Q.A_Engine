import assert from "node:assert/strict";
import { getBlockedScrapeReason } from "./blockedScrapePage";

for (const status of [401, 403, 429, 500, 503, 599]) {
  assert.ok(getBlockedScrapeReason({ status, hostname: "example.com", html: "<main>Product</main>" }));
}

assert.equal(getBlockedScrapeReason({
  status: 200,
  hostname: "www.amazon.com",
  html: '<form action="/errors_page/validateCaptcha"><button>Continue</button></form>',
}), "Amazon returned a verification page instead of product content.");
assert.ok(getBlockedScrapeReason({
  status: 200,
  hostname: "amazon.co.uk",
  html: "<h4>Click the button below to continue shopping</h4>",
}));
assert.equal(getBlockedScrapeReason({ status: 200, hostname: "amazon.in", html: "<main id=productTitle>TV</main>" }), null);
assert.equal(getBlockedScrapeReason({ status: 200, hostname: "example.com", html: '<form action="/validateCaptcha"></form>' }), null);
assert.equal(getBlockedScrapeReason({ status: 200, hostname: "example.com", html: "Click the button below to continue shopping" }), null);
assert.equal(getBlockedScrapeReason({ status: 404, hostname: "example.com", html: "Not found" }), null);

console.log("Blocked scrape page assertions passed.");
