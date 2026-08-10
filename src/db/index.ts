import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import * as dotenv from 'dotenv';

dotenv.config();

// Create or retrieve the connection pool.
export const createPool = () => {
  let connectionString = process.env.DATABASE_URL;
  if (connectionString && connectionString.includes('.supabase.co')) {
    try {
      const url = new URL(connectionString);
      if (url.port === '5432' && url.hostname.startsWith('db.')) {
        const projectRef = url.hostname.split('.')[1];
        url.hostname = 'aws-0-ap-northeast-2.pooler.supabase.com';
        url.port = '6543';
        url.username = url.username + '.' + projectRef;
        connectionString = url.toString();
        console.log('Automatically rewrote Supabase URL to use connection pooler for IPv4 compatibility.');
      }
    } catch (e) {
      console.warn('Failed to rewrite Supabase URL.', e);
    }
  }
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Database operations will fail if executed.");
    return null;
  }
  
  return new Pool({
    connectionString: connectionString,
    max: 10,
    connectionTimeoutMillis: 15000,
  });
};

const pool = createPool();

// Initialize Drizzle with the pool and schema.
export const db = pool ? drizzle(pool, { schema }) : null;
