import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SoftAuthenticator } from './authenticator';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let dan: Session;
const phone = new SoftAuthenticator();

beforeAll(async () => {
  app = await createTestApp({
    PUBLIC_WEB_URL: 'http://localhost:5173',
    PUBLIC_ADMIN_URL: 'http://localhost:5174',
  });
  api = client(app);
  dan = await api.register('dan');
});
afterAll(() => app.close());

const signIn = async (response: unknown, challengeId: string) =>
  api.post('/auth/passkey', null, { challengeId, response });

describe('passkeys', () => {
  it('adds a passkey to the account', async () => {
    const start = await api.post('/me/passkeys/options', dan);
    expect(start.status).toBe(200);
    expect(start.body.options).toMatchObject({
      rp: { id: 'localhost', name: 'OVL For Business' },
      user: { name: 'dan' },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const created = phone.create(start.body.options);
    // A challenge works once and only for the account that asked for it.
    const other = await api.register('eve');
    expect(
      (
        await api.post('/me/passkeys', other, {
          challengeId: start.body.challengeId,
          name: 'x',
          response: created,
        })
      ).status,
    ).toBe(400);
    const added = await api.post('/me/passkeys', dan, {
      challengeId: (await api.post('/me/passkeys/options', dan)).body.challengeId,
      name: 'Laptop',
      response: created,
    });
    // The first challenge was used up above; the new one does not match this response.
    expect(added.status).toBe(400);

    const again = await api.post('/me/passkeys/options', dan);
    const ok = await api.post('/me/passkeys', dan, {
      challengeId: again.body.challengeId,
      name: 'Laptop',
      response: phone.create(again.body.options),
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ id: phone.id, name: 'Laptop', lastUsedAt: null });
    expect((await api.get('/me/passkeys', dan)).body).toHaveLength(1);
    // The next options exclude it, so the same authenticator is not registered twice.
    const next = await api.post('/me/passkeys/options', dan);
    expect(next.body.options.excludeCredentials).toEqual([
      { id: phone.id, type: 'public-key', transports: ['internal'] },
    ]);
  });

  it('signs in without a password (and without an authenticator code)', async () => {
    const start = await api.post('/auth/passkey/options', null);
    expect(start.body.options).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
    const res = await signIn(phone.get(start.body.options), start.body.challengeId);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('dan');
    expect((await api.get('/me', { token: res.body.accessToken, id: '', username: '' })).status).toBe(200);
    expect((await api.get('/me/passkeys', dan)).body[0].lastUsedAt).not.toBeNull();

    // Replaying the same challenge fails; so does a response for another site.
    expect((await signIn(phone.get(start.body.options), start.body.challengeId)).status).toBe(400);
    const phishing = await api.post('/auth/passkey/options', null);
    const fake = await signIn(
      phone.get(phishing.body.options, 'https://evil.example'),
      phishing.body.challengeId,
    );
    expect(fake.status).toBe(401);
    expect(fake.body.error).toBe('passkey_failed');
  });

  it('works from the admin panel origin, and stops after removal', async () => {
    const admin = new SoftAuthenticator('localhost', 'http://localhost:5174');
    const start = await api.post('/me/passkeys/options', dan);
    await api.post('/me/passkeys', dan, {
      challengeId: start.body.challengeId,
      name: 'Security key',
      response: admin.create(start.body.options),
    });
    const login = await api.post('/auth/passkey/options', null);
    expect((await signIn(admin.get(login.body.options), login.body.challengeId)).status).toBe(200);

    expect((await api.del(`/me/passkeys/${encodeURIComponent(admin.id)}`, dan)).status).toBe(204);
    const later = await api.post('/auth/passkey/options', null);
    expect((await signIn(admin.get(later.body.options), later.body.challengeId)).status).toBe(401);
  });
});
