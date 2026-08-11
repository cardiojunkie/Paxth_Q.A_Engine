export const normalizeWebsite = (value: string) => {
  const input = value.trim();
  if (!input) return "";

  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
      .hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const isCompleteWebsiteDomain = (value: string) => {
  const labels = normalizeWebsite(value).split(".");
  const topLevelDomain = labels.at(-1) || "";
  return labels.length > 1
    && topLevelDomain.length > 1
    && !/^\d+$/.test(topLevelDomain)
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
};
