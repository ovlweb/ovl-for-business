import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let founder: Session;
let accountant: Session;
let ann: Session;
let ben: Session;
let orgId: string;
let usdId: string;

const usd = async (s: Session) =>
  (await api.get('/wallets', s)).body.find((w: { currency: string }) => w.currency === 'USD')
    ?.balance as string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  const owner = await api.owner();
  const moderator = await api.withRole('mod', 'moderator');
  founder = await api.register('founder');
  accountant = await api.register('counter');
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
  const approved = await api.post(`/applications/${res.body.id}/review`, owner, { decision: 'approve' });
  orgId = approved.body.result.organizationId;
  await api.post(`/organizations/${orgId}/members`, founder, { username: 'counter', role: 'accountant' });
  await api.deposit(ann, 'USD', '500.00');
  await api.deposit(ben, 'USD', '500.00');
  await api.post('/stock/listings/NWS/invest', ann, { amount: '100' });
  await api.post('/stock/listings/NWS/invest', ben, { amount: '50' });
  usdId = (await api.get(`/organizations/${orgId}/wallets`, founder)).body[0].id;
});
afterAll(() => app.close());

describe('shareholders', () => {
  it('company members see the shareholder registry', async () => {
    const list = await api.get(`/organizations/${orgId}/shareholders`, accountant);
    expect(list.body).toEqual([
      { user: expect.objectContaining({ username: 'ann' }), shares: '20', percent: 66.66 },
      { user: expect.objectContaining({ username: 'ben' }), shares: '10', percent: 33.33 },
    ]);
    expect((await api.get(`/organizations/${orgId}/shareholders`, ann)).status).toBe(403);
  });

  it('dividends pay every shareholder per share', async () => {
    expect(
      (await api.post(`/organizations/${orgId}/dividends`, accountant, { walletId: usdId, perShare: '1' }))
        .status,
    ).toBe(403);
    const paid = await api.post(`/organizations/${orgId}/dividends`, founder, {
      walletId: usdId,
      perShare: '1.25',
      note: 'First year',
    });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({
      status: 'paid',
      shares: '30',
      holders: 2,
      total: '37.50',
      perShare: '1.25',
    });
    expect(await usd(ann)).toBe('425.00');
    expect(await usd(ben)).toBe('462.50');
    const history = await api.get('/stock/listings/NWS/dividends', null);
    expect(history.body).toMatchObject([{ total: '37.50', note: 'First year' }]);
    const entries = await api.get(`/wallets/${usdId}/entries`, founder);
    expect(entries.body.items[0]).toMatchObject({ kind: 'dividend_out', amount: '-37.50' });
    expect(
      (await api.post(`/organizations/${orgId}/dividends`, founder, { walletId: usdId, perShare: '100' }))
        .status,
    ).toBe(409);
  });

  it('above the approval limit a dividend waits for a second signature', async () => {
    await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '20' });
    const pending = await api.post(`/organizations/${orgId}/dividends`, founder, {
      walletId: usdId,
      perShare: '1',
    });
    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({ status: 'pending', total: '30.00' });
    await api.post(
      `/organizations/${orgId}/payment-approvals/${pending.body.approvalId}/approve`,
      accountant,
    );
    const [latest] = (await api.get('/stock/listings/NWS/dividends', null)).body;
    expect(latest).toMatchObject({ id: pending.body.id, status: 'paid' });
    expect(await usd(ann)).toBe('445.00');
    await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '' });
  });

  it('shareholder votes are weighted by the shares held when they opened', async () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const created = await api.post(`/organizations/${orgId}/proposals`, founder, {
      title: 'Build a second studio',
      description: 'Open a studio in the Helios district next year.',
      closesAt: soon,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'open', totalShares: '30', myShares: '0' });
    expect(created.body.options.map((o: { label: string }) => o.label)).toEqual([
      'For',
      'Against',
      'Abstain',
    ]);
    const id = created.body.id;

    // Buying more afterwards does not add votes.
    await api.post('/stock/listings/NWS/invest', ben, { amount: '50' });
    expect((await api.post(`/stock/proposals/${id}/vote`, ann, { option: 'o1' })).body).toMatchObject({
      myVote: 'o1',
      myShares: '20',
    });
    const benVote = await api.post(`/stock/proposals/${id}/vote`, ben, { option: 'o2' });
    expect(benVote.body.myShares).toBe('10');
    expect((await api.post(`/stock/proposals/${id}/vote`, ann, { option: 'o2' })).status).toBe(409);
    expect((await api.post(`/stock/proposals/${id}/vote`, founder, { option: 'o1' })).status).toBe(403);
    expect((await api.post(`/stock/proposals/${id}/vote`, ben, { option: 'nope' })).status).toBe(400);

    const [open] = (await api.get('/stock/listings/NWS/proposals', ann)).body;
    expect(open).toMatchObject({ votedShares: '30', turnoutPercent: 100, winner: null, myVote: 'o1' });
    expect(open.options[0]).toMatchObject({ shares: '20', voters: 1 });

    const closed = await api.post(`/organizations/${orgId}/proposals/${id}/close`, founder);
    expect(closed.body).toMatchObject({ status: 'closed', winner: 'o1' });
    expect((await api.post(`/stock/proposals/${id}/vote`, ann, { option: 'o1' })).status).toBe(409);
    expect(
      (
        await api.post(`/organizations/${orgId}/proposals`, founder, {
          title: 'Too short',
          description: 'This vote would be too short.',
          closesAt: new Date(Date.now() + 60_000).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  it('companies publish reports with figures and documents', async () => {
    const file = await app.inject({
      method: 'POST',
      url: '/api/v1/files?name=q3.pdf',
      headers: { authorization: `Bearer ${founder.token}`, 'content-type': 'application/pdf' },
      payload: Buffer.from('%PDF-1.4 results'),
    });
    const published = await api.post(`/organizations/${orgId}/reports`, founder, {
      period: '2026-Q3',
      title: 'Third quarter results',
      body: 'Revenue grew with the launch of Northwind Online.',
      revenue: '12500.50',
      profit: '-300',
      attachments: [file.json().id],
    });
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({
      period: '2026-Q3',
      revenue: '12500.50',
      profit: '-300.00',
      currency: 'USD',
    });
    expect(published.body.files).toMatchObject([{ name: 'q3.pdf' }]);
    const reports = await api.get('/stock/listings/NWS/reports', null);
    expect(reports.body).toMatchObject([{ title: 'Third quarter results', author: { username: 'founder' } }]);
    const pdf = await app.inject({ method: 'GET', url: reports.body[0].files[0].url });
    expect(pdf.statusCode).toBe(200);
    expect(
      (
        await api.post(`/organizations/${orgId}/reports`, ann, {
          period: '2026',
          title: 'Nope',
          body: 'Not mine at all.',
        })
      ).status,
    ).toBe(403);
  });
});
