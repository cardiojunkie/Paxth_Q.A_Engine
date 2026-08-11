import assert from "node:assert/strict";
import { captureDynamicTabs, type DynamicTabLocator, type DynamicTabPage } from "./captureDynamicTabs.ts";

const tabs = [
  { label: "Basic & Properties", html: "<dl><dt>Model</dt><dd>55A400U</dd></dl>" },
  { label: "Audio", html: "<dl><dt>Speakers</dt><dd>20W</dd></dl>" },
  { label: "Display", html: "<dl><dt>Resolution</dt><dd>4K</dd></dl>" },
];
let active = 0;
let replacement = tabs[0].html;
const waits: number[] = [];

const tabLocator = (index?: number): DynamicTabLocator => ({
  count: async () => tabs.length,
  nth: tabLocator,
  innerText: async () => tabs[index!].label,
  click: async () => {
    if (index === 1) throw new Error("click failed");
    active = index!;
  },
  innerHTML: async () => tabs[active].html,
  evaluate: async () => undefined,
});
const panelLocator = (): DynamicTabLocator => ({
  count: async () => 1,
  nth: panelLocator,
  innerText: async () => "",
  click: async () => undefined,
  innerHTML: async () => tabs[active].html,
  evaluate: async (pageFunction, html) => {
    const element = { innerHTML: replacement } as Element;
    pageFunction(element, html);
    replacement = element.innerHTML;
  },
});
const page: DynamicTabPage = {
  locator: (selector) => selector === ".tabs" ? tabLocator() : panelLocator(),
  waitForTimeout: async (ms) => {
    waits.push(ms);
  },
  url: () => "https://example.com/product",
};

assert.deepEqual(
  await captureDynamicTabs(page, { tabSelector: ".tabs", panelSelector: ".panel", waitMs: 25 }),
  { captured: 2, failures: ["Audio: click failed"] },
);
assert.deepEqual(waits, [25, 25]);
assert.match(replacement, /<h3>Basic &amp; Properties<\/h3>.*Model.*<h3>Display<\/h3>.*Resolution/s);
assert.equal(replacement.match(/55A400U/g)?.length, 1);
assert.doesNotMatch(replacement, /Speakers/);
assert.match(replacement, /role="alert".*Audio: click failed/);
await assert.rejects(
  captureDynamicTabs(page, { tabSelector: ".tabs", panelSelector: ".panel", waitMs: 1.5 }),
  /integer between 0 and 10000/,
);

process.env.CLOAKBROWSER_AUTO_UPDATE = "false";
const { launch } = await import("cloakbrowser");
const browser = await launch({ headless: true });
try {
  const browserPage = await browser.newPage();
  const fixture = `
    <button class="tab">First &amp; More</button>
    <button class="tab">Second</button>
    <div class="panel"><p>Initial panel</p></div>
    <script>
      const panels = ["<p>First panel</p>", "<p>Second panel</p>"];
      document.querySelectorAll(".tab").forEach((tab, index) => {
        tab.addEventListener("click", () => document.querySelector(".panel").innerHTML = panels[index]);
      });
    </script>
  `;
  await browserPage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(fixture)}`, { waitUntil: "domcontentloaded" });
  assert.deepEqual(
    await captureDynamicTabs(browserPage, { tabSelector: ".tab", panelSelector: ".panel", waitMs: 0 }),
    { captured: 2, failures: [] },
  );
  const browserHtml = await browserPage.locator(".panel").innerHTML();
  assert.equal(browserHtml.match(/data-specification-tab/g)?.length, 2);
  assert.match(browserHtml, /<h3>First &amp; More<\/h3>.*First panel.*<h3>Second<\/h3>.*Second panel/s);
  assert.doesNotMatch(browserHtml, /Initial panel/);

  const accordionFixture = `
    <div id="details">
      <button class="expander">Features</button><div class="content">Stale features</div>
      <button class="expander">Measurements</button><div class="content">Stale measurements</div>
    </div>
    <script>
      const details = ["<table><tr><th>Model</th><td>A1</td></tr></table>", "<p>Width: 10 cm</p>"];
      document.querySelectorAll(".expander").forEach((button, index) => {
        button.addEventListener("click", () => document.querySelectorAll(".content")[index].innerHTML = details[index]);
      });
    </script>
  `;
  await browserPage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(accordionFixture)}`, { waitUntil: "domcontentloaded" });
  assert.deepEqual(
    await captureDynamicTabs(browserPage, { tabSelector: ".expander", panelSelector: ".content", waitMs: 0 }),
    { captured: 2, failures: [] },
  );
  const accordionHtml = await browserPage.locator("#details").innerHTML();
  assert.equal(accordionHtml.match(/data-specification-tab/g)?.length, 2);
  assert.match(accordionHtml, /<h3>Features<\/h3>.*Model.*<h3>Measurements<\/h3>.*Width: 10 cm/s);
  assert.equal(accordionHtml.match(/Model/g)?.length, 1);
  assert.equal(accordionHtml.match(/Width: 10 cm/g)?.length, 1);
  assert.doesNotMatch(accordionHtml, /Stale/);
} finally {
  await browser.close();
}
