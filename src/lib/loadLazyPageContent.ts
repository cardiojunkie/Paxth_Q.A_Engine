export type LazyContentPage = {
  evaluate<T>(pageFunction: () => T): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
};

export async function loadLazyPageContent(page: LazyContentPage) {
  let lastHeight = 0;
  let stableBottoms = 0;

  for (let step = 0; step < 30 && stableBottoms < 2; step += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 800)));
    await page.waitForTimeout(100);
    const { height, atBottom } = await page.evaluate(() => {
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      return { height, atBottom: window.scrollY + window.innerHeight >= height - 1 };
    });
    stableBottoms = atBottom && height === lastHeight ? stableBottoms + 1 : 0;
    lastHeight = height;
  }

  await page.waitForTimeout(500);
}
