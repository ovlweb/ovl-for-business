import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { realtimePresence } from '../src/db/schema';
import { cleanRateLimits, postgresRateLimitStore } from '../src/lib/rate-limit-store';
import { client, createTestApp, type Session } from './helpers';

/** Two instances of the server on one database, as behind a load balancer. */
let a: FastifyInstance;
let b: FastifyInstance;
let api: ReturnType<typeof client>;
let alice: Session;
let bob: Session;

const until = async (check: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function connect(app: FastifyInstance, token: string) {
  const { port } = app.server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/realtime?token=${token}`);
  const events: { type: string; message?: { body: string } }[] = [];
  let closed: number | null = null;
  socket.on('close', (code) => (closed = code));
  await new Promise<void>((resolve, reject) => {
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (event.type === 'ready') resolve();
    });
    socket.on('error', reject);
  });
  return { socket, events, closed: () => closed };
}

beforeAll(async () => {
  a = await createTestApp({ REALTIME_BROKER: 'postgres' });
  b = await createTestApp({ REALTIME_BROKER: 'postgres' });
  await a.listen({ port: 0, host: '127.0.0.1' });
  await b.listen({ port: 0, host: '127.0.0.1' });
  api = client(a);
  alice = await api.register('alice');
  bob = await api.register('bob');
});
afterAll(async () => {
  await a.close();
  await b.close();
});

describe('realtime across instances', () => {
  it('delivers events to sockets held by another instance and knows who is online', async () => {
    const onB = await connect(b, bob.token);
    await until(
      async () =>
        (await a.db.select().from(realtimePresence).where(eq(realtimePresence.userId, bob.id))).length === 1,
    );
    expect(a.hub.isOnline(bob.id)).toBe(false);
    expect([...(await a.hub.onlineAmong([bob.id, alice.id]))]).toEqual([bob.id]);

    const chat = (await api.post('/chats/direct', alice, { userId: bob.id })).body.id;
    await api.post(`/chats/${chat}/messages`, alice, { body: 'Hello from instance A' });
    await until(() => onB.events.some((e) => e.message?.body === 'Hello from instance A'));

    // Too big for a NOTIFY payload: it travels through the realtime_events table.
    const long = '€'.repeat(3000);
    await api.post(`/chats/${chat}/messages`, alice, { body: long });
    await until(() => onB.events.some((e) => e.message?.body === long));

    onB.socket.close();
    await until(async () => (await a.hub.onlineAmong([bob.id])).size === 0);
  });

  it('signs out sessions whose socket is on another instance', async () => {
    const onB = await connect(b, bob.token);
    const other = await api.login('bob', 'password-123');
    expect((await api.post('/me/sessions/sign-out-others', other)).status).toBe(200);
    await until(() => onB.closed() === 4401);
  });
});

describe('shared rate limits', () => {
  it('counts requests in Postgres, per route and per window', async () => {
    const Store = postgresRateLimitStore(a.db);
    const store = new Store();
    const route = store.child({ routeInfo: { method: 'POST', url: '/api/v1/auth/login' } });
    const incr = (s: InstanceType<typeof Store>, key: string, window: number) =>
      new Promise<{ current: number; ttl: number }>((resolve, reject) =>
        s.incr(key, (err, res) => (err ? reject(err) : resolve(res!)), window),
      );
    expect((await incr(store, '10.0.0.1', 60_000)).current).toBe(1);
    const second = await incr(store, '10.0.0.1', 60_000);
    expect(second.current).toBe(2);
    expect(second.ttl).toBeGreaterThan(55_000);
    expect(second.ttl).toBeLessThanOrEqual(60_000);
    // Another instance shares the counter; another route counts separately.
    expect((await incr(new (postgresRateLimitStore(b.db))(), '10.0.0.1', 60_000)).current).toBe(3);
    expect((await incr(route, '10.0.0.1', 60_000)).current).toBe(1);

    expect((await incr(store, '10.0.0.2', 50)).current).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect((await incr(store, '10.0.0.2', 50)).current).toBe(1);
    await cleanRateLimits(a.db);
  });
});
