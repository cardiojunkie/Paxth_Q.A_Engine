import assert from 'node:assert/strict';

// QA_PASSWORD=... node scripts/verify-public-access.mjs [https://hostname/]
const base = new URL(process.argv[2] ?? 'https://project22.tail608e42.ts.net/');
assert.equal(base.protocol, 'https:', 'Use HTTPS for the public password gate');
assert.ok(process.env.QA_PASSWORD, 'Set QA_PASSWORD to the existing gate password');
const user = process.env.QA_USERNAME ?? 'paxth-admin';
const authorization = password => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const request = (url, password) => fetch(url, {
  headers: password === undefined ? {} : { Authorization: authorization(password) },
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
});
const password = process.env.QA_PASSWORD;
const home = await request(base, password);
assert.equal(home.status, 200, 'Authenticated home page');
const html = await home.text();
const assetPath = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1];
assert.ok(assetPath, 'Home page references a JavaScript asset');
const asset = new URL(assetPath, base);
assert.equal(asset.origin, base.origin, 'Asset stays on the protected origin');

for (const url of [base, asset, new URL('api/db-status', base), new URL('api/catalog', base)]) {
  for (const invalid of [undefined, `${password}-incorrect`]) {
    const response = await request(url, invalid);
    assert.equal(response.status, 401, `${url.pathname}: reject missing/incorrect credentials`);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic\b/i);
    await response.arrayBuffer();
  }
  const response = await request(url, password);
  assert.equal(response.status, 200, `${url.pathname}: accept valid credentials`);
  if (url.pathname.endsWith('/api/db-status')) {
    assert.equal((await response.json()).status, 'connected', 'Database connected');
  } else if (url.pathname.endsWith('/api/catalog')) {
    assert.ok(Array.isArray(await response.json()), 'Catalog returns an array');
  } else {
    await response.arrayBuffer();
  }
  console.log(`PASS ${url.pathname}: authenticated access and password gate`);
}
