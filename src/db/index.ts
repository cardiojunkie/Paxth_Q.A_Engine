import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import * as dotenv from 'dotenv';

dotenv.config();

// Create or retrieve the connection pool.
export const createPool = () => {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn("DATABASE_URL is not set. Database operations will fail if executed.");
    return null;
  }

  try {
    const url = new URL(connectionString);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('unsupported protocol');
    }
    const isSupabaseHost = url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.pooler.supabase.com');
    if (isSupabaseHost && !url.searchParams.has('sslmode')) {
      console.warn('Supabase DATABASE_URL has no sslmode. Use the exact TLS-enabled connection string from Supabase Dashboard → Connect.');
    }
  } catch {
    console.error('DATABASE_URL must be a valid postgres:// or postgresql:// connection string.');
    return null;
  }
  
  return new Pool({
    connectionString,
    max: 10,
    query_timeout: 15000,
    statement_timeout: 15000,
    keepAlive: true,
    connectionTimeoutMillis: 15000,
  });
};

export const pool = createPool();
pool?.on('error', () => console.error('An idle database connection was lost; requests will reconnect.'));

// Initialize Drizzle with the pool and schema.
export const db = pool ? drizzle(pool, { schema }) : null;
