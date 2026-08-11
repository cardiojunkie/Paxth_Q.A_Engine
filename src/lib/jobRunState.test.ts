import assert from "node:assert/strict";
import {
  getCommonAttributeSet,
  getCommonHeaderOrder,
} from "./jobRunState.ts";

assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "TV" }]), "TV");
assert.equal(getCommonAttributeSet([]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "Audio" }]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, { attribute_set: "tv" }]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: "TV" }, {}]), null);
assert.equal(getCommonAttributeSet([{ attribute_set: " " }]), null);

const persistedHeaders = JSON.parse(JSON.stringify(["10", "2", "sku"]));
assert.deepEqual(
  getCommonHeaderOrder([
    { source: { headerOrder: persistedHeaders }, raw_row: { sku: "1" } },
    { source: { headerOrder: ["10", "2", "sku"] }, raw_row: { sku: "2" } },
  ]),
  { headers: ["10", "2", "sku"], legacy: false },
);
assert.equal(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { source: { headerOrder: ["title", "sku"] } },
  ]),
  null,
);
assert.deepEqual(getCommonHeaderOrder([{ raw_row: { sku: "1", title: "Item", qa_result: {} } }]), {
  headers: ["sku", "title"],
  legacy: true,
});
assert.deepEqual(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { raw_row: { sku: "2" } },
  ]),
  { headers: ["sku", "title"], legacy: true },
);
assert.equal(
  getCommonHeaderOrder([
    { source: { headerOrder: ["sku", "title"] } },
    { raw_row: { sku: "2", color: "Red" } },
  ]),
  null,
);
assert.deepEqual(
  getCommonHeaderOrder([
    { raw_row: { sku: "1", title: "Item", color: "Red" } },
    { raw_row: { sku: "2", color: "Blue" } },
  ]),
  { headers: ["sku", "title", "color"], legacy: true },
);
assert.equal(getCommonHeaderOrder([]), null);
