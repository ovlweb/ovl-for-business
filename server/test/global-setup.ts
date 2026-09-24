import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './env';

/** Recreate the test database schema once per test run. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists.length) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await client.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await migrate(drizzle(client), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await client.end();
}
