export type DynamicTabLocator = {
  count(): Promise<number>;
  nth(index: number): DynamicTabLocator;
  innerText(): Promise<string>;
  click(options?: { timeout?: number }): Promise<void>;
  innerHTML(): Promise<string>;
  evaluate(pageFunction: (element: Element, html: string) => unknown, html: string): Promise<unknown>;
};

export type DynamicTabPage = {
  locator(selector: string): DynamicTabLocator;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
};

export type DynamicTabOptions = {
  tabSelector: string;
  panelSelector: string;
  waitMs?: number;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);

const pagePath = (value: string) => {
  const url = new URL(value);
  return `${url.origin}${url.pathname}${url.search}`;
};

export async function captureDynamicTabs(
  page: DynamicTabPage,
  { tabSelector, panelSelector, waitMs = 300 }: DynamicTabOptions,
) {
  if (!tabSelector.trim() || !panelSelector.trim()) throw new Error("Dynamic tab selectors cannot be empty");
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10_000) {
    throw new Error("Dynamic tab wait must be an integer between 0 and 10000 ms");
  }

  const tabs = page.locator(tabSelector);
  const tabCount = await tabs.count();
  if (tabCount < 1 || tabCount > 50) throw new Error(`Expected 1-50 dynamic tabs, found ${tabCount}`);

  const initialPanelCount = await page.locator(panelSelector).count();
  const pairedPanels = initialPanelCount === tabCount && tabCount > 1;
  if (initialPanelCount !== 1 && !pairedPanels) {
    throw new Error(`Expected one shared panel or ${tabCount} paired panels, found ${initialPanelCount}`);
  }

  const labels = await Promise.all(Array.from({ length: tabCount }, async (_, index) => {
    try {
      return (await tabs.nth(index).innerText()).trim() || `Tab ${index + 1}`;
    } catch {
      return `Tab ${index + 1}`;
    }
  }));
  const captures: Array<{ index: number; label: string; html: string }> = [];
  const failures: string[] = [];
  const originalPath = pagePath(page.url());

  for (let index = 0; index < tabCount; index += 1) {
    const label = labels[index];
    try {
      await tabs.nth(index).click({ timeout: 5_000 });
      if (pagePath(page.url()) !== originalPath) throw new Error("tab click navigated away from the product page");
      if (waitMs) await page.waitForTimeout(waitMs);
      if (pagePath(page.url()) !== originalPath) throw new Error("tab click navigated away from the product page");

      const panels = page.locator(panelSelector);
      const panelCount = await panels.count();
      if (panelCount !== initialPanelCount) {
        throw new Error(`expected ${initialPanelCount} panel${initialPanelCount === 1 ? "" : "s"}, found ${panelCount}`);
      }
      captures.push({ index, label, html: await panels.nth(pairedPanels ? index : 0).innerHTML() });
    } catch (error) {
      if (pagePath(page.url()) !== originalPath) throw error;
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!captures.length) throw new Error(`No dynamic tabs were captured${failures.length ? `: ${failures.join("; ")}` : ""}`);

  const warning = failures.length
    ? `<p role="alert">Specification tabs not captured: ${escapeHtml(failures.join("; "))}</p>`
    : "";
  const finalPanels = page.locator(panelSelector);
  const finalPanelCount = await finalPanels.count();
  if (finalPanelCount !== initialPanelCount) {
    throw new Error(`Cannot replace dynamic tab panels: found ${finalPanelCount}`);
  }

  if (pairedPanels) {
    const capturesByPanel = new Map(captures.map(capture => [capture.index, capture]));
    for (let index = 0; index < initialPanelCount; index += 1) {
      const capture = capturesByPanel.get(index);
      const replacement = capture
        ? `<section data-specification-tab><h3>${escapeHtml(capture.label)}</h3>${capture.html}</section>${capture === captures[0] ? warning : ""}`
        : "";
      await finalPanels.nth(index).evaluate((element, html) => {
        element.innerHTML = html;
      }, replacement);
    }
  } else {
    const html = captures
      .map(({ label, html: panelHtml }) => `<section data-specification-tab><h3>${escapeHtml(label)}</h3>${panelHtml}</section>`)
      .join("") + warning;
    await finalPanels.nth(0).evaluate((element, replacement) => {
      element.innerHTML = replacement;
    }, html);
  }

  return { captured: captures.length, failures };
}
