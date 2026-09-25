import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, timeStep } from '../src/lib/totp';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  app = await createTestApp({
    REQUIRE_2FA_FOR_STAFF: 'true',
    REQUIRE_2FA_FOR_COMPANY_FINANCE: 'true',
    REQUIRE_VERIFIED_EMAIL: 'true',
  });
  api = client(app);
});
afterAll(() => app.close());

let step = 0;
/** Turn on two-step verification for a session (codes from successive time steps). */
async function enableTwoFactor(s: Session) {
  const setup = await api.post('/me/2fa/setup', s);
  const code = hotp(base32Decode(setup.body.secret), timeStep() + (step++ % 2));
  expect((await api.post('/me/2fa/enable', s, { code })).status).toBe(200);
}
const verify = async (email: string) => {
  const mail = app.mailer.outbox.find((m) => m.to === email)!;
  const token = mail.text.match(/verify-email\?token=([\w-]+)/)![1];
  await api.post('/auth/verify-email', null, { token });
};

describe('security policy', () => {
  it('is published in /meta', async () => {
    expect((await api.get('/meta')).body.security).toEqual({
      twoFactorForStaff: true,
      twoFactorForCompanyFinance: true,
      verifiedEmailForApplications: true,
      identityForCompanies: false,
    });
  });

  it('staff tools need two-step verification; the account keeps working as a regular user', async () => {
    const owner = await api.owner();
    const stats = await api.get('/admin/stats', owner);
    expect(stats.status).toBe(403);
    expect(stats.body.error).toBe('two_factor_setup_required');
    expect((await api.get('/me', owner)).status).toBe(200);
    await enableTwoFactor(owner);
    expect((await api.get('/admin/stats', owner)).status).toBe(200);
  });

  it('applications need a confirmed email, and company money needs two-step verification', async () => {
    const founder = await api.register('founder');
    const payload = {
      type: 'company',
      payload: {
        name: 'Nova Studio',
        description: 'Virtual game studio',
        baseCurrency: 'USD',
        businessPlan: 'Make and sell virtual games',
        listOnExchange: false,
      },
    };
    const early = await api.post('/applications', founder, payload);
    expect(early.status).toBe(403);
    expect(early.body.error).toBe('email_not_verified');
    await verify('founder@example.test');
    const submitted = await api.post('/applications', founder, payload);
    expect(submitted.status).toBe(201);

    // The owner has two-step verification on since the previous test, so signing in needs a code.
    expect(
      (await api.post('/auth/login', null, { login: 'owner', password: 'owner-password-123' })).status,
    ).toBe(401);
    const moderator = await api.register('mod');
    await app.db.execute(sql`update users set role = 'moderator' where id = ${moderator.id}`);
    const blocked = await api.post(`/applications/${submitted.body.id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS,
    });
    expect(blocked.body.error).toBe('two_factor_setup_required');
    await enableTwoFactor(moderator);
    await api.post(`/applications/${submitted.body.id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS,
    });
    expect((await api.get('/applications/queue', moderator)).status).toBe(200);
  });

  it('owners, directors and accountants turn it on before moving company money', async () => {
    const boss = await api.register('boss');
    await verify('boss@example.test');
    // Build a company directly: approval flows are covered elsewhere.
    const [org] = await app.db.execute<{ id: string }>(
      sql`insert into organizations (name, slug, description, base_currency, owner_id)
          values ('Boss Co', 'boss-co', 'Test', 'USD', ${boss.id}) returning id`,
    );
    await app.db.execute(
      sql`insert into organization_members (organization_id, user_id, role) values (${org!.id}, ${boss.id}, 'owner')`,
    );
    const wallet = (await api.post(`/organizations/${org!.id}/wallets`, boss, { currency: 'USD' })).body;
    const request = await api.post(`/wallets/${wallet.id}/cash-requests`, boss, {
      type: 'deposit',
      method: 'manager_transfer',
      amount: '10',
    });
    expect(request.status).toBe(403);
    expect(request.body.error).toBe('two_factor_setup_required');
    // Reading the balance still works.
    expect((await api.get(`/wallets/${wallet.id}`, boss)).status).toBe(200);
    await enableTwoFactor(boss);
    expect(
      (
        await api.post(`/wallets/${wallet.id}/cash-requests`, boss, {
          type: 'deposit',
          method: 'manager_transfer',
          amount: '10',
        })
      ).status,
    ).toBe(201);
  });
});
