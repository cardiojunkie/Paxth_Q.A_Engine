import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword, initializeAuth } from '../src/server/auth.ts';

// Usage: npm run admin:bootstrap -- [--recover-legacy]; optional BOOTSTRAP_ADMIN_* overrides.
// Recovery is explicit and only permitted when no administrator has a usable scrypt hash.
const recoverLegacy = process.argv.includes('--recover-legacy');
if (process.argv.slice(2).some(value => value !== '--recover-legacy')) throw new Error('Only --recover-legacy is supported.');
const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'Aswath').trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'potusdown@2230';
if (!process.env.DATABASE_URL || !username || username.length > 100 || /[\x00-\x1f\x7f]/.test(username) || !password) {
  throw new Error('Set DATABASE_URL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (12–256 characters).');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const hashed = await hashPassword(password);
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  await initializeAuth(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(21422, 1)');
    const admins = (await client.query("SELECT id, password FROM users WHERE role = 'admin'")).rows;
    if (admins.some(account => /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(account.password)) || (admins.length && !recoverLegacy)) {
      throw new Error('An administrator exists. Use account management, or --recover-legacy only if all admin passwords are legacy plaintext.');
    }
    const existing = (await client.query('SELECT id FROM users WHERE lower(btrim(username)) = lower($1)', [username])).rows[0];
    if (existing && recoverLegacy) {
      await client.query("UPDATE users SET password = $2, role = 'admin' WHERE id = $1", [existing.id, hashed]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
    } else {
      await client.query("INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, 'admin')", [randomUUID(), username, hashed]);
    }
    await client.query('COMMIT');
    console.log('Administrator created. Remove bootstrap credentials from the environment.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
