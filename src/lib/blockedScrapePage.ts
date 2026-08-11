export type BlockedScrapePage = {
  status?: number | null;
  hostname: string;
  html: string;
};

const amazonMarketplace = /(^|\.)amazon\.(?:[a-z]{2,3}|(?:co|com)\.[a-z]{2})$/i;
const amazonCaptchaForm = /<form\b[^>]*\baction\s*=\s*["'][^"']*validateCaptcha[^"']*["']/i;
const amazonContinuePrompt = /Click the button below to continue shopping/i;

export function getBlockedScrapeReason({ status, hostname, html }: BlockedScrapePage) {
  if (status === 401 || status === 403 || status === 429 || (status != null && status >= 500 && status <= 599)) {
    return `Source website returned HTTP ${status}.`;
  }

  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (amazonMarketplace.test(host) && (amazonCaptchaForm.test(html) || amazonContinuePrompt.test(html))) {
    return "Amazon returned a verification page instead of product content.";
  }

  return null;
}
