import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ipAllowlist } from '../src/lib/ip-allowlist';
import { client, createTestApp, type Session } from './helpers';

describe('admin IP allow-list', () => {
  it('matches IPv4, IPv6 and IPv4-mapped addresses', () => {
    const allowed = ipAllowlist('10.0.0.0/8, 203.0.113.7, 2001:db8::/32')!;
    expect(allowed('10.20.30.40')).toBe(true);
    expect(allowed('::ffff:10.1.1.1')).toBe(true);
    expect(allowed('203.0.113.7')).toBe(true);
    expect(allowed('203.0.113.8')).toBe(false);
    expect(allowed('2001:db8::1')).toBe(true);
    expect(allowed('2001:db9::1')).toBe(false);
    expect(ipAllowlist('')).toBeNull();
    expect(() => ipAllowlist('not-an-ip')).toThrow();
  });

  it('keeps the admin API to the listed networks', async () => {
    const app = await createTestApp({ ADMIN_IP_ALLOWLIST: '10.0.0.0/8' });
    const api = client(app);
    const owner = await api.owner();
    const call = (remoteAddress: string, url = '/api/v1/admin/stats') =>
      app.inject({ method: 'GET', url, remoteAddress, headers: { authorization: `Bearer ${owner.token}` } });
    const outside = await call('198.51.100.9');
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error).toBe('ip_not_allowed');
    expect((await call('10.4.5.6')).statusCode).toBe(200);
    // Everything else stays open.
    expect((await call('198.51.100.9', '/api/v1/me')).statusCode).toBe(200);
    await app.close();
  });
});

describe('four eyes for large cash operations', () => {
  let app: FastifyInstance;
  let api: ReturnType<typeof client>;
  let alice: Session;
  let bob: Session;
  let zoe: Session;

  beforeAll(async () => {
    app = await createTestApp({ CASH_FOUR_EYES_AMOUNT: '1000' });
    api = client(app);
    alice = await api.withRole('alice', 'manager');
    bob = await api.withRole('bob', 'manager');
    zoe = await api.register('zoe');
  });
  afterAll(() => app.close());

  const desk = (as: Session, type: string, amount: string) =>
    api.post('/admin/cash-operations', as, {
      ownerType: 'user',
      ownerId: zoe.id,
      currency: 'USD',
      amount,
      type,
      method: 'manager_transfer',
      reference: `REF-${amount}`,
    });
  const balance = async () =>
    (await api.get('/wallets', zoe)).body.find((w: { currency: string }) => w.currency === 'USD');

  it('smaller amounts go through at once; large ones wait for a second manager', async () => {
    expect((await desk(alice, 'deposit', '999.99')).status).toBe(201);
    const big = await desk(alice, 'deposit', '5000');
    expect(big.status).toBe(202);
    expect(big.body).toMatchObject({
      kind: 'operation',
      status: 'pending',
      amount: '5000.00',
      requestedBy: { username: 'alice' },
    });
    expect((await balance()).balance).toBe('999.99');
    expect((await api.get('/admin/stats', bob)).body.pendingCashApprovals).toBe(1);

    expect((await api.post(`/admin/cash-approvals/${big.body.id}/approve`, alice)).status).toBe(403);
    const ok = await api.post(`/admin/cash-approvals/${big.body.id}/approve`, bob);
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: { username: 'bob' } });
    expect((await balance()).balance).toBe('5999.99');
    const journal = (await api.get('/admin/cash-operations', bob)).body.items;
    expect(journal[0]).toMatchObject({ amount: '5000.00', processedBy: { username: 'alice' } });
    expect((await api.post(`/admin/cash-approvals/${big.body.id}/approve`, bob)).status).toBe(409);
  });

  it('large payouts hold the money until decided', async () => {
    const payout = await desk(bob, 'withdrawal', '2000');
    expect(payout.status).toBe(202);
    expect(await balance()).toMatchObject({ balance: '5999.99', available: '3999.99' });
    const rejected = await api.post(`/admin/cash-approvals/${payout.body.id}/reject`, alice, {
      reason: 'No signed slip',
    });
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectReason: 'No signed slip' });
    expect((await balance()).available).toBe('5999.99');
    expect((await desk(bob, 'withdrawal', '7000')).status).toBe(409);
  });

  it('completing a large request also needs the second manager', async () => {
    const wallet = await balance();
    const asked = await api.post(`/wallets/${wallet.id}/cash-requests`, zoe, {
      type: 'withdrawal',
      method: 'physical_cash',
      amount: '1500',
    });
    const first = await api.post(`/admin/cash-requests/${asked.body.id}/complete`, alice, {
      reference: 'SLIP-1',
    });
    expect(first.body).toMatchObject({ status: 'pending', awaitingApproval: true });
    expect(
      (await api.post(`/admin/cash-requests/${asked.body.id}/complete`, bob, { reference: 'SLIP-2' })).status,
    ).toBe(409);
    const [approval] = (await api.get('/admin/cash-approvals?status=pending', bob)).body;
    expect(approval).toMatchObject({ kind: 'request', cashRequestId: asked.body.id, reference: 'SLIP-1' });
    await api.post(`/admin/cash-approvals/${approval.id}/approve`, bob);
    const [done] = (await api.get(`/wallets/${wallet.id}/cash-requests`, zoe)).body;
    expect(done).toMatchObject({ status: 'completed', reference: 'SLIP-1', awaitingApproval: false });
    expect((await balance()).balance).toBe('4499.99');
  });

  it('nobody confirms an operation on their own balance', async () => {
    const own = await api.post('/admin/cash-operations', alice, {
      ownerType: 'user',
      ownerId: bob.id,
      currency: 'USD',
      amount: '3000',
      type: 'deposit',
      method: 'physical_cash',
      reference: 'BOB-1',
    });
    const res = await api.post(`/admin/cash-approvals/${own.body.id}/approve`, bob);
    expect(res.status).toBe(403);
  });
});

describe('single sign-on (OpenID Connect)', () => {
  let idp: FastifyInstance;
  let app: FastifyInstance;
  let api: ReturnType<typeof client>;
  let issuer = '';
  const codes = new Map<
    string,
    { email: string; nonce: string; challenge: string; emailVerified?: boolean }
  >();

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    idp = Fastify();
    idp.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );
    idp.get('/.well-known/openid-configuration', async () => ({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    }));
    idp.get('/jwks', async () => ({ keys: [jwk] }));
    idp.post('/token', async (req, reply) => {
      const b = req.body as Record<string, string>;
      const grant = codes.get(b.code!);
      const pkce = createHash('sha256')
        .update(b.code_verifier ?? '')
        .digest('base64url');
      if (
        !grant ||
        b.client_secret !== 's3cret' ||
        pkce !== grant.challenge ||
        b.redirect_uri !== 'http://localhost:5174/'
      )
        return reply.status(400).send({ error: 'invalid_grant' });
      codes.delete(b.code!);
      const idToken = await new SignJWT({
        email: grant.email,
        email_verified: grant.emailVerified ?? true,
        nonce: grant.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience('ovl-admin')
        .setSubject('idp-user-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return { access_token: 'x', token_type: 'Bearer', id_token: idToken };
    });
    const address = await idp.listen({ port: 0, host: '127.0.0.1' });
    issuer = address;
    app = await createTestApp({
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'ovl-admin',
      OIDC_CLIENT_SECRET: 's3cret',
      OIDC_LABEL: 'Sign in with Acme SSO',
      PUBLIC_ADMIN_URL: 'http://localhost:5174',
      REQUIRE_2FA_FOR_STAFF: 'true',
    });
    api = client(app);
    // Staff need two-step here, so the owner cannot promote through the API: set the role directly.
    const mia = await api.register('mia');
    await app.db.execute(sql`update users set role = 'moderator' where id = ${mia.id}`);
  });
  afterAll(async () => {
    await app.close();
    await idp.close();
  });

  /** Start, "sign in at the provider", and hand the code back like the admin panel does. */
  const signIn = async (email: string, opts: { nonce?: string; emailVerified?: boolean } = {}) => {
    const start = await api.post('/auth/sso/start', null);
    const url = new URL(start.body.url);
    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`);
    const p = url.searchParams;
    expect(p.get('code_challenge_method')).toBe('S256');
    const code = `code-${Math.random()}`;
    codes.set(code, {
      email,
      nonce: opts.nonce ?? p.get('nonce')!,
      challenge: p.get('code_challenge')!,
      emailVerified: opts.emailVerified,
    });
    return {
      res: await api.post('/auth/sso/callback', null, { code, state: p.get('state') }),
      state: p.get('state')!,
      code,
    };
  };

  it('is offered with its label', async () => {
    expect((await api.get('/auth/sso')).body).toEqual({ enabled: true, label: 'Sign in with Acme SSO' });
  });

  it('signs staff in by their verified email, as a strong session', async () => {
    const { res } = await signIn('Mia@example.test');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'mia', strongSession: true });
    const token = { token: res.body.accessToken, id: '', username: '' };
    // Two-step is required for staff here, and a single sign-on session satisfies it.
    expect((await api.get('/admin/stats', token)).status).toBe(200);
    expect((await api.get('/me', token)).body.strongSession).toBe(true);
  });

  it('refuses other accounts, replays and mismatched nonces', async () => {
    await api.register('ned');
    expect((await signIn('ned@example.test')).res.body.error).toBe('sso_no_account');
    expect((await signIn('nobody@example.test')).res.status).toBe(403);
    expect((await signIn('mia@example.test', { nonce: 'forged' })).res.body.error).toBe('sso_failed');
    expect((await signIn('mia@example.test', { emailVerified: false })).res.status).toBe(401);
    const { state, code } = await signIn('mia@example.test');
    const replay = await api.post('/auth/sso/callback', null, { code, state });
    expect(replay.status).toBe(401);
  });
});
