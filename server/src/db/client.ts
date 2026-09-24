import path from 'node:path';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Db = Database | Tx;

export function createDatabase(url: string, poolSize = 10) {
  const client = postgres(url, { max: poolSize, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function migrationsFolder(): string {
  return path.resolve(process.cwd(), process.env.MIGRATIONS_DIR ?? 'drizzle');
}

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
