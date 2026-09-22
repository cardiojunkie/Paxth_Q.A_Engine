import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Pool, PoolClient } from 'pg';

const COOKIE = 'paxth_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const USER_FIELDS = 'id, username, role, created_at AS "createdAt", last_login AS "lastLogin"';
const PASSWORD_PATTERN = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
let activeHashes = 0;

class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function derive(password: string, salt: string): Promise<Buffer> {
  // ponytail: two memory-heavy hashes per process; use a shared admission limit if replicas are added.
  if (activeHashes >= 2) throw new AuthError(429, 'Authentication is busy. Please retry shortly.');
  activeHashes++;
  try {
    return await new Promise((resolve, reject) => scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
  } finally { activeHashes--; }
}

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new AuthError(400, 'Password must contain 12 to 256 characters.');
  }
}

export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const valid = PASSWORD_PATTERN.test(encoded);
  const [, salt, digest] = (valid ? encoded : DUMMY_HASH).split('$');
  const candidate = await derive(password, salt);
  return timingSafeEqual(candidate, Buffer.from(digest, 'hex')) && valid;
}

export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function initializeAuth(pool: Pool) {
  await pool.query(`
    DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin','user'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY, username text NOT NULL UNIQUE, password text NOT NULL,
      role user_role NOT NULL DEFAULT 'user',
      last_login timestamp, created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_username_idx ON users (lower(btrim(username)));
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  `);
}

function username(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new AuthError(400, 'Username must contain 1 to 100 printable characters.');
  }
  return value.trim();
}

function role(value: unknown) {
  if (value !== 'admin' && value !== 'user') throw new AuthError(400, 'Role must be admin or user.');
  return value;
}

export function requiresAdmin(method: string, path: string) {
  const normalized = path.toLowerCase();
  return method === 'DELETE' || /^\/(users|chat)(\/|$)/.test(normalized) ||
    (!['GET', 'HEAD', 'OPTIONS'].includes(method) && /^\/(attribute-sets|site-selectors|qa-agent-memory|provider-settings)(\/|$)/.test(normalized));
}

function sessionToken(req: Request) {
  const value = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function endpoint(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof AuthError) {
        if (error.status === 429) res.setHeader('Retry-After', '60');
        res.status(error.status).json({ error: error.message });
      } else if ((error as { code?: string })?.code === '23505') {
        res.status(409).json({ error: 'That username already exists.' });
      } else {
        console.error('Authentication database operation failed.');
        res.status(503).json({ error: 'Authentication service unavailable. Please retry.' });
      }
    }
  };
}

async function withUserLock<T>(pool: Pool, actorId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(21422, 1)');
    const actor = await client.query('SELECT role FROM users WHERE id = $1', [actorId]);
    if (actor.rows[0]?.role !== 'admin') throw new AuthError(403, 'Administrator access required.');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function registerAuth(app: Express, pool: Pool) {
  const production = process.env.NODE_ENV === 'production';
  let configuredOrigin: string | undefined;
  if (process.env.APP_ORIGIN) {
    const url = new URL(process.env.APP_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) {
      throw new Error('APP_ORIGIN must be an HTTPS origin in production, without a path or credentials.');
    }
    configuredOrigin = url.origin;
  }
  if (production && !configuredOrigin) throw new Error('APP_ORIGIN is required in production.');
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict' as const, path: '/' };
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = configuredOrigin ?? `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expected || req.get('sec-fetch-site') === 'cross-site') {
        res.status(403).json({ error: 'Same-origin requests are required.' });
        return;
      }
    }
    next();
  });

  // ponytail: bounded process-local throttling; use a gateway/shared limiter for multiple server replicas.
  const attempts = new Map<string, { count: number; expires: number }>();
  let totalAttempts = { count: 0, expires: 0 };
  app.post('/api/auth/login', endpoint(async (req, res) => {
    const name = username(req.body?.username);
    if (typeof req.body?.password !== 'string' || !req.body.password || req.body.password.length > 256) throw new AuthError(400, 'Invalid login credentials.');
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
    if (totalAttempts.expires <= now) totalAttempts = { count: 0, expires: now + 15 * 60_000 };
    const key = `${req.socket.remoteAddress}:${name.toLowerCase()}`;
    const entry = attempts.get(key) ?? { count: 0, expires: now + 15 * 60_000 };
    if (entry.count >= 10 || totalAttempts.count >= 100 || (!attempts.has(key) && attempts.size >= 1000)) throw new AuthError(429, 'Too many login attempts. Try again later.');
    entry.count++; totalAttempts.count++; attempts.set(key, entry);
    const result = await pool.query('SELECT id, username, role, password FROM users WHERE lower(btrim(username)) = lower($1)', [name]);
    const account = result.rows[0];
    if (!await verifyPassword(req.body.password, account?.password ?? DUMMY_HASH)) throw new AuthError(401, 'Invalid username or password.');
    const token = randomBytes(32).toString('hex');
    const client = await pool.connect();
    let loginTime: Date;
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT password, role FROM users WHERE id = $1 FOR UPDATE', [account.id]);
      if (!current.rows[0] || current.rows[0].password !== account.password) throw new AuthError(401, 'Account changed. Sign in again.');
      account.role = current.rows[0].role;
      const priorToken = sessionToken(req);
      await client.query('DELETE FROM sessions WHERE expires_at <= now() OR token_hash = $1', [priorToken ? hashSessionToken(priorToken) : '']);
      const session = await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'8 hours\') RETURNING created_at', [hashSessionToken(token), account.id]);
      loginTime = session.rows[0].created_at;
      await client.query('UPDATE users SET last_login = now() WHERE id = $1', [account.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    attempts.delete(key);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ id: account.id, username: account.username, role: account.role, loginTime });
  }));

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = sessionToken(req);
      if (!token) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
      const result = await pool.query(`SELECT u.id, u.username, u.role, s.created_at AS "loginTime" FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashSessionToken(token)]);
      if (!result.rows[0]) { res.clearCookie(COOKIE, cookieOptions); res.status(401).json({ error: 'Session expired. Sign in again.' }); return; }
      res.locals.user = result.rows[0];
      if (requiresAdmin(req.method, req.path) && res.locals.user.role !== 'admin') { res.status(403).json({ error: 'Administrator access required.' }); return; }
      next();
    } catch { res.status(503).json({ error: 'Authentication service unavailable.' }); }
  });

  app.get('/api/auth/me', (_req, res) => { res.json(res.locals.user); });
  app.post('/api/auth/logout', endpoint(async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(sessionToken(req)!)]);
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ success: true });
  }));
  app.get('/api/users', endpoint(async (_req, res) => {
    res.json((await pool.query(`SELECT ${USER_FIELDS} FROM users ORDER BY created_at DESC`)).rows);
  }));
  app.post('/api/users', endpoint(async (req, res) => {
    const name = username(req.body?.username);
    const newRole = role(req.body?.role);
    const password = await hashPassword(req.body?.password);
    const account = await withUserLock(pool, res.locals.user.id, async client => (await client.query(`INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_FIELDS}`, [randomUUID(), name, password, newRole])).rows[0]);
    res.status(201).json(account);
  }));
  app.put('/api/users/:id', endpoint(async (req, res) => {
    const name = req.body?.username === undefined ? undefined : username(req.body.username);
    const newRole = req.body?.role === undefined ? undefined : role(req.body.role);
    const password = req.body?.password === undefined ? undefined : await hashPassword(req.body.password);
    if (name === undefined && newRole === undefined && password === undefined) throw new AuthError(400, 'No account changes supplied.');
    const account = await withUserLock(pool, res.locals.user.id, async client => {
      const current = (await client.query('SELECT id, role, password FROM users WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!current) throw new AuthError(404, 'User not found.');
      if (current.role === 'admin' && PASSWORD_PATTERN.test(current.password) && newRole === 'user' && (await client.query("SELECT id FROM users WHERE role = 'admin' AND password ~ $1", [PASSWORD_PATTERN.source])).rowCount === 1) throw new AuthError(409, 'The last administrator cannot be demoted.');
      const updated = await client.query(`UPDATE users SET username = COALESCE($2, username), password = COALESCE($3, password), role = COALESCE($4, role) WHERE id = $1 RETURNING ${USER_FIELDS}`, [req.params.id, name ?? null, password ?? null, newRole ?? null]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      return updated.rows[0];
    });
    res.json(account);
  }));
  app.delete('/api/users/:id', endpoint(async (req, res) => {
    await withUserLock(pool, res.locals.user.id, async client => {
      const account = (await client.query('SELECT role, password FROM users WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!account) throw new AuthError(404, 'User not found.');
      if (account.role === 'admin' && PASSWORD_PATTERN.test(account.password) && (await client.query("SELECT id FROM users WHERE role = 'admin' AND password ~ $1", [PASSWORD_PATTERN.source])).rowCount === 1) throw new AuthError(409, 'The last administrator cannot be deleted.');
      await client.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    });
    res.json({ success: true });
  }));
}
