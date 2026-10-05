import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export class ScrapeError extends Error {
  constructor(message: string, public status = 502, public code = 'RETRIEVAL_FAILED') { super(message); }
}

const reserved = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) reserved.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) reserved.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function isPublicAddress(address: string) {
  return isIP(address) === 4 ? !reserved.check(address, 'ipv4')
    : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !reserved.check(address, 'ipv6');
}

export function validateScrapeInput(body: unknown): { url: string } {
  const value = (body as { url?: unknown })?.url;
  if (typeof value !== 'string' || !value.trim()) throw new ScrapeError('URL is required.', 400, 'INVALID_URL');
  let raw = value.trim();
  if (/[\s\\\x00-\x1f]/.test(raw)) throw new ScrapeError('Invalid URL provided.', 400, 'INVALID_URL');
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ScrapeError('Invalid URL provided.', 400, 'INVALID_URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      (isIP(host) ? !isPublicAddress(host) : !host.includes('.') || /(^|\.)(localhost|local|internal|lan)$|\.home\.arpa$/.test(host))) {
    throw new ScrapeError('Use a public HTTP(S) URL on port 80 or 443 without embedded credentials.', 400, 'INVALID_URL');
  }
  url.hash = '';
  return { url: url.href };
}

export async function resolvePublicAddress(url: URL, resolve = lookup, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const done = new AbortController();
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      resolve(host, { all: true }),
      delay(5_000, undefined, { signal: AbortSignal.any([done.signal, signal]) }).then(() => { throw new ScrapeError('Public URL lookup timed out.', 504, 'TIMEOUT'); }),
    ]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
      throw new ScrapeError('The URL must resolve exclusively to public internet addresses.', 400, 'PRIVATE_ADDRESS');
    }
    return addresses.find(item => item.family === 4) ?? addresses[0];
  } finally { done.abort(); }
}
