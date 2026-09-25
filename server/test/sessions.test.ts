import type { AuthResult, Session } from '@ovl/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { refreshTokens } from '../src/db/schema';
import { sha256 } from '../src/lib/crypto';
import { client, createTestApp } from './helpers';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const APP = 'OVLBusiness/0.1.0 (android 15)';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let baseUrl: string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(() => app.close());

async function signIn(username: string, userAgent: string, password = 'password-123'): Promise<AuthResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'user-agent': userAgent },
    payload: { login: username, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as AuthResult;
}

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as never,
  });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

describe('sessions', () => {
  it('lists signed-in devices and signs one out immediately', async () => {
    await api.register('sam');
    const laptop = await signIn('sam', CHROME);
    const phone = await signIn('sam', APP);

    const list = await call('GET', '/me/sessions', laptop.accessToken);
    expect(list.status).toBe(200);
    const sessions = list.body as Session[];
    const current = sessions.find((s) => s.current)!;
    expect(current.device).toBe('Chrome on Windows');
    expect(sessions.map((s) => s.device)).toContain('OVL Business app on Android');

    // The phone keeps a live connection; signing it out closes it and kills its tokens.
    const socket = new WebSocket(`${baseUrl}/api/v1/realtime?token=${phone.accessToken}`);
    await new Promise<void>((resolve) => socket.once('message', () => resolve()));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));

    const phoneSession = sessions.find((s) => s.device.startsWith('OVL Business app'))!;
    expect((await call('DELETE', `/me/sessions/${phoneSession.id}`, laptop.accessToken)).status).toBe(204);
    expect(await closed).toBe(4401);

    const denied = await call('GET', '/me', phone.accessToken);
    expect(denied.status).toBe(401);
    expect(denied.body.message).toBe('This session was signed out');
    const refresh = await api.post('/auth/refresh', null, { refreshToken: phone.refreshToken });
    expect(refresh.status).toBe(401);
    expect((await call('GET', '/me', laptop.accessToken)).status).toBe(200);
  });

  it('keeps one session across refreshes and signs out every other device', async () => {
    await api.register('tess');
    const a = await signIn('tess', CHROME);
    await signIn('tess', APP);
    await signIn('tess', 'curl/8.5.0');
    const refreshed = await api.post('/auth/refresh', null, { refreshToken: a.refreshToken });
    expect(refreshed.status).toBe(200);
    // Registering signed in too, so there are four devices.
    const before = (await call('GET', '/me/sessions', refreshed.body.accessToken)).body as Session[];
    expect(before).toHaveLength(4);
    expect(before.filter((s) => s.device === 'API client')).toHaveLength(1);

    const out = await call('POST', '/me/sessions/sign-out-others', refreshed.body.accessToken);
    expect(out.body).toEqual({ signedOut: 3 });
    const after = (await call('GET', '/me/sessions', refreshed.body.accessToken)).body as Session[];
    expect(after.map((s) => s.current)).toEqual([true]);
  });

  it('treats a refresh token reused long after rotation as theft', async () => {
    await api.register('uma');
    const first = await signIn('uma', CHROME);
    const second = await api.post('/auth/refresh', null, { refreshToken: first.refreshToken });
    expect(second.status).toBe(200);

    // Immediate re-use (two tabs refreshing together) is refused but harmless.
    expect((await api.post('/auth/refresh', null, { refreshToken: first.refreshToken })).status).toBe(401);
    expect((await call('GET', '/me', second.body.accessToken)).status).toBe(200);

    // The same re-use two minutes later signs the whole session out.
    await app.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now() - interval '2 minutes'` })
      .where(eq(refreshTokens.tokenHash, sha256(first.refreshToken)));
    expect((await api.post('/auth/refresh', null, { refreshToken: first.refreshToken })).status).toBe(401);
    expect((await call('GET', '/me', second.body.accessToken)).status).toBe(401);
    expect((await api.post('/auth/refresh', null, { refreshToken: second.body.refreshToken })).status).toBe(
      401,
    );
  });

  it('changing the password signs out the other devices only', async () => {
    await api.register('vic');
    const here = await signIn('vic', CHROME);
    const there = await signIn('vic', APP);
    const change = await call('POST', '/me/password', here.accessToken, {
      currentPassword: 'password-123',
      newPassword: 'new-password-456',
    });
    expect(change.status).toBe(204);
    expect((await call('GET', '/me', here.accessToken)).status).toBe(200);
    expect((await call('GET', '/me', there.accessToken)).status).toBe(401);
    expect((await api.post('/auth/refresh', null, { refreshToken: here.refreshToken })).status).toBe(200);
  });

  it('signing out ends the session; admins can sign an account out everywhere', async () => {
    await api.register('wes');
    const s = await signIn('wes', CHROME);
    expect((await api.post('/auth/logout', null, { refreshToken: s.refreshToken })).status).toBe(204);
    expect((await call('GET', '/me', s.accessToken)).status).toBe(401);

    const again = await signIn('wes', APP);
    const owner = await api.owner();
    const out = await api.post(`/admin/users/${again.user.id}/sign-out`, owner);
    expect(out.body).toEqual({ signedOut: 2 }); // the registration session and the app
    expect((await call('GET', '/me', again.accessToken)).status).toBe(401);
    const log = await api.get('/admin/audit-logs?action=user.sign_out', owner);
    expect(log.body.items[0]).toMatchObject({ action: 'user.sign_out', targetId: again.user.id });
  });
});
