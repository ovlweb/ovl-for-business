import { RISK_DISCLOSURE } from '@ovl/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let ann: Session;
let ben: Session;

const invest = (as: Session, amount: string) => api.post('/stock/listings/NWS/invest', as, { amount });
const accept = (as: Session) => api.post('/stock/risk/accept', as, { version: RISK_DISCLOSURE.version });

beforeAll(async () => {
  app = await createTestApp({ STOCK_REQUIRE_RISK_ACK: 'true' });
  api = client(app);
  owner = await api.owner();
  const moderator = await api.withRole('mod', 'moderator');
  const founder = await api.register('founder');
  ann = await api.register('ann');
  ben = await api.register('ben');
  const res = await api.post('/applications', founder, {
    type: 'company',
    payload: {
      name: 'Northwind Studio',
      description: 'Virtual game studio',
      baseCurrency: 'USD',
      businessPlan: 'Make and sell virtual games',
      listOnExchange: true,
      listing: { ticker: 'NWS', sharePrice: '5', totalShares: 1000 },
    },
  });
  await api.post(`/applications/${res.body.id}/review`, moderator, {
    decision: 'approve',
    checklist: ALL_COMPANY_CHECKS,
  });
  await api.post(`/applications/${res.body.id}/review`, owner, { decision: 'approve' });
  await api.deposit(ann, 'USD', '5000.00');
  await api.deposit(ben, 'USD', '5000.00');
});
afterAll(() => app.close());

describe('risk disclosure', () => {
  it('has to be accepted before the first investment or buy order', async () => {
    const anonymous = await api.get('/stock/risk', null);
    expect(anonymous.body).toMatchObject({ version: RISK_DISCLOSURE.version, acceptedAt: null });
    expect(anonymous.body.points.length).toBeGreaterThan(3);

    const refused = await invest(ann, '50');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('risk_disclosure_required');
    const buy = await api.post('/stock/listings/NWS/orders', ann, { side: 'buy', shares: 1, price: '5' });
    expect(buy.body.error).toBe('risk_disclosure_required');

    expect((await api.post('/stock/risk/accept', ann, { version: '2020-01' })).status).toBe(400);
    const accepted = await accept(ann);
    expect(accepted.status).toBe(200);
    expect(accepted.body.acceptedAt).toEqual(expect.any(String));
    expect((await accept(ann)).status).toBe(200);
    expect((await api.get('/stock/risk', ann)).body.acceptedAt).toBe(accepted.body.acceptedAt);
    expect((await invest(ann, '50')).status).toBe(201);
  });
});

describe('investor limits', () => {
  it('nobody may hold more than the maximum share of a company', async () => {
    await accept(ben);
    // 25% of 1000 shares by default; ann already holds 10.
    const tooMuch = await invest(ann, '1250');
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.message).toMatch(/25% of NWS \(250 shares\)/);
    expect((await invest(ann, '1200')).status).toBe(201);

    // Open buy orders count too.
    const order = await api.post('/stock/listings/NWS/orders', ben, { side: 'buy', shares: 200, price: '5' });
    expect(order.status).toBe(201);
    expect((await invest(ben, '500')).status).toBe(409);
    expect((await invest(ben, '250')).status).toBe(201);

    expect((await api.put('/admin/stock/limits', ann, { maxHoldingPercent: 50 })).status).toBe(403);
    const raised = await api.put('/admin/stock/limits', owner, { maxHoldingPercent: 50 });
    expect(raised.body).toMatchObject({ maxHoldingPercent: 50, monthlyLimit: null, base: 'USD' });
    expect((await invest(ben, '500')).status).toBe(201);
  });

  it('caps what someone puts in per 30 days, lower without a verified identity', async () => {
    await api.put('/admin/stock/limits', owner, { monthlyLimit: '2000', unverifiedMonthlyLimit: '1500' });
    expect((await api.get('/stock/limit-settings', null)).body).toMatchObject({
      maxHoldingPercent: 50,
      monthlyLimit: '2000.00',
      unverifiedMonthlyLimit: '1500.00',
    });
    // Ben invested 250 + 500 and has 1000 in an open buy order.
    const mine = await api.get('/stock/limits', ben);
    expect(mine.body).toMatchObject({
      monthlyLimit: '1500.00',
      usedThisMonth: '1750.00',
      remaining: '0.00',
      identityVerified: false,
    });
    const over = await invest(ben, '5');
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/limit of 1500.00 USD per 30 days/);

    await app.db.update(users).set({ identityVerifiedAt: new Date() }).where(eq(users.id, ben.id));
    expect((await api.get('/stock/limits', ben)).body).toMatchObject({
      monthlyLimit: '2000.00',
      remaining: '250.00',
      identityVerified: true,
    });
    expect((await invest(ben, '300')).status).toBe(409);
    expect((await invest(ben, '250')).status).toBe(201);

    // Selling is never limited, and cancelling a buy order frees its part of the limit.
    const [open] = (await api.get('/stock/orders', ben)).body;
    expect((await api.del(`/stock/orders/${open.id}`, ben)).status).toBe(200);
    expect((await api.get('/stock/limits', ben)).body.remaining).toBe('1000.00');

    await api.put('/admin/stock/limits', owner, { monthlyLimit: '', unverifiedMonthlyLimit: '' });
    expect((await api.get('/stock/limits', ben)).body).toMatchObject({ monthlyLimit: null, remaining: null });
  });
});
