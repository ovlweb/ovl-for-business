import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
});
afterAll(() => app.close());

describe('auth', () => {
  it('registers, logs in and returns the profile with permissions', async () => {
    const alice = await api.register('alice');
    const me = await api.get('/me', alice);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ username: 'alice', role: 'user', badges: [], permissions: [] });

    const owner = await api.owner();
    const ownerMe = await api.get('/me', owner);
    expect(ownerMe.body.badges).toEqual(['owner']);
    expect(ownerMe.body.permissions).toContain('wallet.cash');
  });

  it('stores synced preferences (theme, onboarding) and merges updates', async () => {
    const erin = await api.register('erin');
    expect((await api.get('/me', erin)).body.preferences).toEqual({});
    await api.patch('/me/preferences', erin, { theme: 'emerald' });
    const merged = await api.patch('/me/preferences', erin, { onboardingCompleted: true, goals: ['invest'] });
    expect(merged.body.preferences).toEqual({
      theme: 'emerald',
      onboardingCompleted: true,
      goals: ['invest'],
    });
    expect((await api.patch('/me/preferences', erin, { theme: 'neon-pink' })).status).toBe(400);
  });

  it('rejects duplicate usernames and bad passwords', async () => {
    await api.register('bob');
    const dup = await api.post('/auth/register', null, {
      username: 'bob',
      email: 'other@example.test',
      password: 'password-123',
      displayName: 'Bob',
    });
    expect(dup.status).toBe(409);
    const bad = await api.post('/auth/login', null, { login: 'bob', password: 'nope' });
    expect(bad.status).toBe(401);
  });

  it('rotates refresh tokens and refuses reuse', async () => {
    const login = await api.post('/auth/login', null, { login: 'alice', password: 'password-123' });
    const first = login.body.refreshToken;
    const refreshed = await api.post('/auth/refresh', null, { refreshToken: first });
    expect(refreshed.status).toBe(200);
    const reused = await api.post('/auth/refresh', null, { refreshToken: first });
    expect(reused.status).toBe(401);
  });

  it('blocks suspended accounts', async () => {
    const carol = await api.register('carol');
    const owner = await api.owner();
    expect((await api.patch(`/admin/users/${carol.id}`, owner, { status: 'suspended' })).status).toBe(200);
    expect((await api.get('/me', carol)).status).toBe(403);
    expect((await api.post('/auth/login', null, { login: 'carol', password: 'password-123' })).status).toBe(
      403,
    );
  });

  it('limits who can assign roles', async () => {
    const admin = await api.withRole('adminuser', 'admin');
    const dave = await api.register('dave');
    expect((await api.patch(`/admin/users/${dave.id}`, admin, { role: 'moderator' })).status).toBe(200);
    expect((await api.patch(`/admin/users/${dave.id}`, admin, { role: 'council' })).status).toBe(403);
    expect((await api.patch(`/admin/users/${dave.id}`, dave, { role: 'admin' })).status).toBe(403);
  });
});
