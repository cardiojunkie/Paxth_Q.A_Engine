import assert from "node:assert/strict";
import { loadLazyPageContent, type LazyContentPage } from "./loadLazyPageContent";

const states = [
  { height: 1600, atBottom: false },
  { height: 2400, atBottom: false },
  { height: 2400, atBottom: true },
  { height: 2400, atBottom: true },
];
const waits: number[] = [];
let evaluations = 0;
const page: LazyContentPage = {
  evaluate: async <T>() => (++evaluations % 2 ? undefined : states.shift()) as T,
  waitForTimeout: async (ms) => { waits.push(ms); },
};

await loadLazyPageContent(page);
assert.equal(evaluations, 8);
assert.deepEqual(waits, [100, 100, 100, 100, 500]);

console.log("Lazy content scroll assertions passed.");
