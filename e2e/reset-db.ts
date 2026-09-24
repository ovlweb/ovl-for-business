// Recreates the end-to-end database before the API server starts.
import postgres from 'postgres';

const url = new URL(process.env.E2E_DATABASE_URL ?? 'postgres://ovl:ovl@localhost:5432/ovl_e2e');
const name = url.pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const sql = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
await sql.unsafe(`drop database if exists "${name}" with (force)`);
await sql.unsafe(`create database "${name}"`);
await sql.end();
console.log(`e2e database ${name} recreated`);
