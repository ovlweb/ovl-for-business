import type { AuthResult } from '@ovl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { bootstrap } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { TEST_DATABASE_URL } from './env';

export const OWNER = { login: 'owner', password: 'owner-password-123' };

export async function createTestApp(overrides: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_SIZE: '5',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    OWNER_USERNAME: OWNER.login,
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: OWNER.password,
    COUNCIL_QUORUM: '3',
    ...overrides,
  });
  const app = await buildApp(config);
  const tables = await app.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (names) await app.db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await bootstrap(app);
  return app;
}

export interface Session {
  token: string;
  id: string;
  username: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Small typed wrapper around app.inject. */
export function client(app: FastifyInstance) {
  async function call<T = any>(method: Method, url: string, session?: Session | null, body?: unknown) {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: session ? { authorization: `Bearer ${session.token}` } : {},
      payload: body as never,
    });
    const json = res.body ? (JSON.parse(res.body) as T) : (undefined as T);
    return { status: res.statusCode, body: json };
  }

  const toSession = (r: AuthResult): Session => ({
    token: r.accessToken,
    id: r.user.id,
    username: r.user.username,
  });

  return {
    call,
    get: <T = any>(url: string, s?: Session | null) => call<T>('GET', url, s),
    post: <T = any>(url: string, s: Session | null, body?: unknown) => call<T>('POST', url, s, body ?? {}),
    patch: <T = any>(url: string, s: Session | null, body?: unknown) => call<T>('PATCH', url, s, body ?? {}),
    del: <T = any>(url: string, s: Session | null) => call<T>('DELETE', url, s),

    async register(username: string): Promise<Session> {
      const res = await call<AuthResult>('POST', '/auth/register', null, {
        username,
        email: `${username}@example.test`,
        password: 'password-123',
        displayName: username[0]!.toUpperCase() + username.slice(1),
      });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
      return toSession(res.body);
    },

    async login(login: string, password: string): Promise<Session> {
      const res = await call<AuthResult>('POST', '/auth/login', null, { login, password });
      if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
      return toSession(res.body);
    },

    async owner(): Promise<Session> {
      return this.login(OWNER.login, OWNER.password);
    },

    /** Register a user and give them a platform role (done by the owner). */
    async withRole(username: string, role: string): Promise<Session> {
      const session = await this.register(username);
      const owner = await this.owner();
      const res = await call('PATCH', `/admin/users/${session.id}`, owner, { role });
      if (res.status !== 200) throw new Error(`role change failed: ${JSON.stringify(res.body)}`);
      return session;
    },

    async deposit(
      to: Session | { ownerType: 'organization'; ownerId: string },
      currency: string,
      amount: string,
    ) {
      const owner = await this.owner();
      const target = 'token' in to ? { ownerType: 'user', ownerId: to.id } : to;
      const res = await call('POST', '/admin/cash-operations', owner, {
        ...target,
        currency,
        amount,
        type: 'deposit',
        method: 'physical_cash',
        reference: 'TEST-1',
      });
      if (res.status !== 201) throw new Error(`deposit failed: ${JSON.stringify(res.body)}`);
      return res.body;
    },
  };
}

export const ALL_COMPANY_CHECKS = ['identity', 'company', 'business_plan', 'license', 'listing'];
export const ALL_LICENSE_CHECKS = ['holder', 'content', 'virtual_only'];
