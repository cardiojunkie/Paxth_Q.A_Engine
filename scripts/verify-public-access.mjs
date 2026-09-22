import assert from 'node:assert/strict';

// QA_PASSWORD=... APP_USERNAME=... APP_PASSWORD=... node scripts/verify-public-access.mjs [https://hostname/]
const base = new URL(process.argv[2] ?? 'https://project22.tail608e42.ts.net/');
assert.equal(base.protocol, 'https:', 'Use HTTPS for the public password gate');
assert.ok(process.env.QA_PASSWORD, 'Set QA_PASSWORD to the existing gate password');
const user = process.env.QA_USERNAME ?? 'paxth-admin';
const authorization = password => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const request = (url, password, cookie) => fetch(url, {
  headers: { ...(password === undefined ? {} : { Authorization: authorization(password) }), ...(cookie ? {Cookie:cookie} : {}) },
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
  if (url.pathname.startsWith('/api/')) {
    assert.equal(response.status,401,'Gateway credentials alone must not authorize application APIs');
    await response.arrayBuffer();
    continue;
  }
  assert.equal(response.status, 200, `${url.pathname}: accept valid gateway credentials`);
  if (url.pathname.endsWith('/api/db-status')) {
    assert.equal((await response.json()).status, 'connected', 'Database connected');
  } else if (url.pathname.endsWith('/api/catalog')) {
    assert.ok(Array.isArray(await response.json()), 'Catalog returns an array');
  } else {
    await response.arrayBuffer();
  }
  console.log(`PASS ${url.pathname}: authenticated access and password gate`);
}

assert.ok(process.env.APP_USERNAME && process.env.APP_PASSWORD, 'Set APP_USERNAME and APP_PASSWORD to a bootstrapped application account');
const login = await fetch(new URL('api/auth/login',base), {
  method:'POST', headers:{Authorization:authorization(password),Origin:base.origin,'Content-Type':'application/json'},
  body:JSON.stringify({username:process.env.APP_USERNAME,password:process.env.APP_PASSWORD}),
  redirect:'manual',signal:AbortSignal.timeout(20000),
});
assert.equal(login.status,200,'Application login');
const session = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(session,'Application session cookie');
try {
  for(const endpoint of ['api/db-status','api/catalog']) {
    const response=await request(new URL(endpoint,base),password,session);
    assert.equal(response.status,200,`Application access: ${endpoint}`);
    const data=await response.json();
    if(endpoint.endsWith('catalog')) assert.ok(Array.isArray(data));
    else assert.equal(data.status,'connected');
  }
  console.log('PASS application session and protected data');
} finally {
  await fetch(new URL('api/auth/logout',base),{method:'POST',headers:{Authorization:authorization(password),Origin:base.origin,Cookie:session},redirect:'manual',signal:AbortSignal.timeout(20000)});
}
