import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(address, prefix, "ipv6");

type Lookup = typeof dnsLookup;

function publicAddress(address: string) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) {
    const mapped = address.slice(address.lastIndexOf(":") + 1);
    return isIP(mapped) === 4 && !blocked.check(mapped, "ipv4");
  }
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export async function requirePublicHttpsUrl(input: unknown, lookup: Lookup = dnsLookup) {
  if (typeof input !== "string" || !input.trim() || input.length > 2048) throw new Error("A valid HTTPS URL is required");
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("A valid HTTPS URL is required");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS URLs on the default port are allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || (!isIP(hostname) && !hostname.includes("."))) {
    throw new Error("Private or local hosts are not allowed");
  }
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("The URL resolves to a private or reserved address");
  url.hostname = hostname;
  return url;
}
