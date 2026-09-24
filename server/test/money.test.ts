import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let manager: Session;
let founder: Session;
let investor: Session;
let orgId: string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  manager = await api.withRole('cashier', 'manager');
  founder = await api.register('founder');
  investor = await api.register('investor');
  const moderator = await api.withRole('mod', 'moderator');

  const res = await api.post('/applications', founder, {
    type: 'company',
    payload: {
      name: 'Nova Studio',
      description: 'Virtual game studio',
      baseCurrency: 'USD',
      businessPlan: 'Make and sell virtual games',
      listOnExchange: true,
      listing: { ticker: 'NOVA', sharePrice: '2.50', totalShares: 100 },
    },
  });
  await api.post(`/applications/${res.body.id}/review`, moderator, {
    decision: 'approve',
    checklist: ALL_COMPANY_CHECKS,
  });
  const approved = await api.post(`/applications/${res.body.id}/review`, owner, { decision: 'approve' });
  orgId = approved.body.result.organizationId;
});
afterAll(() => app.close());

describe('cash desk', () => {
  it('only finance staff can deposit, in any world currency', async () => {
    const payload = {
      ownerType: 'user',
      ownerId: investor.id,
      currency: 'USD',
      amount: '100.00',
      type: 'deposit',
      method: 'manager_transfer',
      reference: 'BANK-42',
    };
    expect((await api.post('/admin/cash-operations', investor, payload)).status).toBe(403);
    const ok = await api.post('/admin/cash-operations', manager, payload);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ amount: '100.00', currency: 'USD', method: 'manager_transfer' });

    const yen = await api.post('/admin/cash-operations', manager, {
      ...payload,
      currency: 'JPY',
      amount: '5000',
    });
    expect(yen.status).toBe(201);
    const badDecimals = await api.post('/admin/cash-operations', manager, {
      ...payload,
      currency: 'JPY',
      amount: '1.5',
    });
    expect(badDecimals.status).toBe(400);

    const wallets = await api.get('/wallets', investor);
    expect(wallets.body.map((w: { currency: string; balance: string }) => [w.currency, w.balance])).toEqual([
      ['JPY', '5000'],
      ['USD', '100.00'],
    ]);
  });

  it('keeps a statement and refuses overdrafts', async () => {
    const usd = (await api.get('/wallets', investor)).body.find(
      (w: { currency: string }) => w.currency === 'USD',
    );
    const statement = await api.get(`/wallets/${usd.id}/entries`, investor);
    expect(statement.body.items[0]).toMatchObject({
      kind: 'deposit',
      amount: '100.00',
      balanceAfter: '100.00',
    });

    const withdraw = await api.post('/admin/cash-operations', manager, {
      ownerType: 'user',
      ownerId: investor.id,
      currency: 'USD',
      amount: '1000',
      type: 'withdrawal',
      method: 'physical_cash',
      reference: 'DESK-1',
    });
    expect(withdraw.status).toBe(409);
    expect(withdraw.body.error).toBe('insufficient_funds');
  });
});

describe('stock exchange', () => {
  it('converts the investment into whole shares and freezes 30% on the company balance', async () => {
    const res = await api.post('/stock/listings/NOVA/invest', investor, { amount: '26.00' });
    expect(res.status).toBe(201);
    // 26.00 / 2.50 = 10 whole shares → 25.00 charged, 7.50 frozen
    expect(res.body).toMatchObject({ shares: '10', amount: '25.00', frozenAmount: '7.50' });
    const unlocksIn = (new Date(res.body.unlocksAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(unlocksIn)).toBe(90);

    const investorUsd = (await api.get('/wallets', investor)).body.find(
      (w: { currency: string }) => w.currency === 'USD',
    );
    expect(investorUsd.balance).toBe('75.00');

    const companyWallets = await api.get(`/organizations/${orgId}/wallets`, founder);
    expect(companyWallets.body[0]).toMatchObject({ balance: '25.00', frozen: '7.50', available: '17.50' });
    expect((await api.get(`/organizations/${orgId}/wallets`, investor)).status).toBe(403);

    const listing = await api.get('/stock/listings/NOVA', null);
    expect(listing.body).toMatchObject({
      sharesSold: '10',
      sharesAvailable: '90',
      raised: '25.00',
      investorsCount: 1,
    });

    const portfolio = await api.get('/stock/portfolio', investor);
    expect(portfolio.body.holdings[0]).toMatchObject({ ticker: 'NOVA', shares: '10', invested: '25.00' });
  });

  it('rejects investments below one share or above the available shares', async () => {
    expect((await api.post('/stock/listings/NOVA/invest', investor, { amount: '1.00' })).status).toBe(400);
    await api.deposit(investor, 'USD', '1000');
    expect((await api.post('/stock/listings/NOVA/invest', investor, { amount: '500' })).status).toBe(409);
  });

  it('the company cannot spend frozen money until it unlocks', async () => {
    const wallet = (await api.get(`/organizations/${orgId}/wallets`, founder)).body[0];
    const tooMuch = await api.post('/wallets/transfer', founder, {
      fromWalletId: wallet.id,
      to: { type: 'user', username: 'founder' },
      amount: '20.00',
    });
    expect(tooMuch.status).toBe(409);
    const ok = await api.post('/wallets/transfer', founder, {
      fromWalletId: wallet.id,
      to: { type: 'user', username: 'founder' },
      amount: '17.50',
      note: 'Salary',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ balance: '7.50', frozen: '7.50', available: '0.00' });

    // Fast-forward: the lock period is over.
    await app.db.execute(sql`update fund_locks set unlocks_at = now() - interval '1 second'`);
    const after = await api.get(`/wallets/${wallet.id}`, founder);
    expect(after.body).toMatchObject({ balance: '7.50', frozen: '0.00', available: '7.50' });
  });

  it('admins can adjust the listing within the 3–6 month lock window', async () => {
    const listing = (await api.get('/stock/listings/NOVA', null)).body;
    expect((await api.patch(`/admin/stock/listings/${listing.id}`, owner, { lockDays: 30 })).status).toBe(
      400,
    );
    const updated = await api.patch(`/admin/stock/listings/${listing.id}`, owner, {
      lockDays: 180,
      freezePercent: 25,
      sharePrice: '3.00',
    });
    expect(updated.body).toMatchObject({ lockDays: 180, freezePercent: 25, sharePrice: '3.00' });
    const detail = await api.get('/stock/listings/NOVA', null);
    expect(detail.body.priceHistory.map((p: { price: string }) => p.price)).toEqual(['2.50', '3.00']);
  });
});

describe('transfers', () => {
  it('moves money between people in the same currency only', async () => {
    const usd = (await api.get('/wallets', investor)).body.find(
      (w: { currency: string }) => w.currency === 'USD',
    );
    const res = await api.post('/wallets/transfer', investor, {
      fromWalletId: usd.id,
      to: { type: 'organization', slug: 'nova-studio' },
      amount: '5',
    });
    expect(res.status).toBe(200);
    const stranger = await api.register('stranger');
    const stolen = await api.post('/wallets/transfer', stranger, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'stranger' },
      amount: '1',
    });
    expect(stolen.status).toBe(403);
  });
});

describe('public API keys', () => {
  it('lets services query the registry and exchange with an X-API-Key', async () => {
    const created = await api.post('/api-keys', investor, { name: 'My integration' });
    expect(created.status).toBe(201);
    const key = created.body.key as string;
    expect(key.startsWith('ovl_')).toBe(true);

    const withKey = await app.inject({
      method: 'GET',
      url: '/api/v1/stock/listings',
      headers: { 'x-api-key': key },
    });
    expect(withKey.statusCode).toBe(200);
    expect(JSON.parse(withKey.body)[0].ticker).toBe('NOVA');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/registry',
      headers: { 'x-api-key': 'ovl_nope' },
    });
    expect(bad.statusCode).toBe(401);

    await api.del(`/api-keys/${created.body.id}`, investor);
    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/registry',
      headers: { 'x-api-key': key },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('records privileged actions in the audit log', async () => {
    const logs = await api.get('/admin/audit-logs?action=wallet.', owner);
    expect(logs.body.total).toBeGreaterThan(0);
    expect((await api.get('/admin/audit-logs', manager)).status).toBe(403);
  });
});
