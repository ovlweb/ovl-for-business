import { OvlApiError, OvlClient, type RealtimeEvent } from '@ovl/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, OWNER } from './helpers';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await createTestApp({ ACCESS_TOKEN_TTL_SECONDS: '60' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(() => app.close());

describe('@ovl/sdk against the real server', () => {
  it('covers auth, contacts, chats, wallets and realtime', async () => {
    const alice = new OvlClient({ baseUrl });
    const bob = new OvlClient({ baseUrl });
    const owner = new OvlClient({ baseUrl });
    await owner.auth.login({ login: OWNER.login, password: OWNER.password });
    const a = await alice.auth.register({
      username: 'alice',
      email: 'alice@example.test',
      password: 'password-123',
      displayName: 'Alice',
    });
    const b = await bob.auth.register({
      username: 'bob',
      email: 'bob@example.test',
      password: 'password-123',
      displayName: 'Bob',
    });

    await alice.contacts.add('bob');
    expect((await alice.contacts.list()).map((c) => c.username)).toEqual(['bob']);

    const live = bob.realtime();
    const events: RealtimeEvent[] = [];
    live.on((e) => events.push(e));
    await new Promise<void>((resolve) => live.onStatus((s) => s === 'open' && resolve()));

    const group = await alice.chats.createGroup({ title: 'Deals', memberIds: [b.id] });
    await alice.chats.send(group.id, 'Hello team');
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'message.created' && e.message.body === 'Hello team')).toBe(true);
    live.close();

    await owner.admin.cashOperation({
      ownerType: 'user',
      ownerId: a.id,
      currency: 'GBP',
      amount: '12.34',
      type: 'deposit',
      method: 'physical_cash',
      reference: 'SDK',
    });
    const [wallet] = await alice.wallets.list();
    expect(wallet).toMatchObject({ currency: 'GBP', balance: '12.34', available: '12.34' });

    const error = await alice.admin.stats().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OvlApiError);
    expect((error as OvlApiError).status).toBe(403);
  });

  it('refreshes an invalid access token transparently', async () => {
    const client = new OvlClient({ baseUrl });
    await client.auth.login({ login: OWNER.login, password: OWNER.password });
    const tokens = client.tokens.get()!;
    client.tokens.set({ ...tokens, accessToken: 'expired' });
    const me = await client.me.get();
    expect(me.role).toBe('owner');
    expect(client.tokens.get()!.refreshToken).not.toBe(tokens.refreshToken);
  });
});
