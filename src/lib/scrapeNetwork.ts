import { lookup } from 'node:dns/promises';
import { Agent, createServer, request as httpRequest } from 'node:http';
import { BlockList, isIP, createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export type ScrapeReport = {
  durationMs: number; characters: number; clicks: number; scrolls: number;
  warnings: Array<{ code: string; message: string }>; unresolvedControls: string[];
};
export class ScrapeError extends Error {
  constructor(message: string, public status = 502, public code = 'RETRIEVAL_FAILED', public report?: ScrapeReport) { super(message); }
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
  if (value.length > 8192) throw new ScrapeError('The URL exceeds 8,192 characters.', 400, 'INVALID_URL');
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

/** Each TCP connection uses a validated numeric address: Chromium cannot re-resolve it. */
export async function startScrapeProxy(resolve = lookup, connect = createConnection, signal = new AbortController().signal) {
  const sockets = new Set<Socket>();
  let closed = false;
  let blocked: ScrapeError | undefined;
  let targetHost = '', targetError: ScrapeError | undefined, blockedCount = 0;
  const hostname = (value: string) => new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const dial = async (target: string) => {
    signal.throwIfAborted();
    const url = new URL(validateScrapeInput({ url: target }).url);
    const address = await resolvePublicAddress(url, resolve, signal);
    if (closed) throw new Error('Proxy closed');
    const socket = track(connect({ host: address.address, family: address.family, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) }));
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => socket.destroy(new Error('Connection timed out')), 10_000);
      socket.once('connect', () => { clearTimeout(timeout); accept(); });
      socket.once('error', error => { clearTimeout(timeout); reject(error); });
      socket.once('close', () => { clearTimeout(timeout); reject(new Error('Connection closed')); });
    });
    return socket;
  };
  const record = (error: unknown, target: string) => {
    blocked = error instanceof ScrapeError ? error : new ScrapeError('The public page connection failed.', 502,
      ['ENOTFOUND', 'EAI_AGAIN'].includes((error as NodeJS.ErrnoException)?.code || '') ? 'DNS_LOOKUP_FAILED' : 'CONNECTION_FAILED');
    blockedCount++;
    try {
      if (hostname(target) === targetHost && targetError?.code !== 'PRIVATE_ADDRESS') targetError = blocked;
    } catch { /* Invalid proxy targets have no matching hostname. */ }
  };
  const server = createServer(async (req, res) => {
    let socket: Socket | undefined;
    try {
      const url = new URL(req.url!);
      if (url.protocol !== 'http:') throw new ScrapeError('Unsupported proxy request.', 400);
      socket = await dial(url.href);
      if (res.destroyed) { socket.destroy(); return; }
      const headers = { ...req.headers, host: url.host, connection: 'close' };
      for (const name of ['proxy-authorization', 'proxy-connection', 'connection', 'upgrade']) delete headers[name];
      const agent = new Agent({ keepAlive: false });
      agent.createConnection = () => socket!;
      const upstream = httpRequest(url, { method: req.method, headers, agent }, response => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.once('close', () => { upstream.destroy(); agent.destroy(); });
      req.pipe(upstream);
    } catch (error) {
      socket?.destroy(); record(error, req.url || '');
      if (!res.headersSent) res.writeHead(error instanceof ScrapeError ? 403 : 502);
      res.end('Page connection rejected.');
    }
  });
  server.on('connection', socket => track(socket));
  server.on('connect', async (req, client, head) => {
    let remote: Socket | undefined;
    try {
      if (!req.url || /[\s/@?#\\]/.test(req.url)) throw new ScrapeError('Invalid tunnel destination.', 400);
      remote = await dial('https://' + req.url);
      if (client.destroyed) { remote.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client);
      client.once('close', () => remote?.destroy());
      remote.once('close', () => client.destroy());
    } catch (error) {
      remote?.destroy(); record(error, 'https://' + req.url);
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.requestTimeout = 120_000;
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  return {
    server: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    get blocked() { return blocked; },
    setTarget(url: string) { targetHost = hostname(url); },
    get targetError() { return targetError; },
    get blockedCount() { return blockedCount; },
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(accept => server.close(() => accept()));
    },
  };
}
