import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let manager: Session;
let founder: Session;
let accountant: Session;
let bob: Session;
let orgId: string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  manager = await api.withRole('trader', 'manager');
  const moderator = await api.withRole('mod', 'moderator');
  founder = await api.register('founder');
  accountant = await api.register('counter');
  bob = await api.register('bob');

  const res = await api.post('/applications', founder, {
    type: 'company',
    payload: {
      name: 'Nova Studio',
      description: 'Virtual game studio',
      baseCurrency: 'USD',
      businessPlan: 'Make and sell virtual games',
      listOnExchange: false,
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

const wallets = async (s: Session) =>
  (await api.get<{ id: string; currency: string; balance: string; available: string }[]>('/wallets', s)).body;
const orgWallets = async (s: Session) =>
  (
    await api.get<{ id: string; currency: string; balance: string; frozen: string; available: string }[]>(
      `/organizations/${orgId}/wallets`,
      s,
    )
  ).body;

describe('currency exchange', () => {
  it('staff with exchange.manage set the rates and the fee', async () => {
    expect((await api.put('/admin/exchange', bob, { feePercent: '1' })).status).toBe(403);
    const set = await api.put('/admin/exchange', manager, {
      base: 'USD',
      feePercent: '0.5',
      rates: [
        { currency: 'EUR', rate: '1.08' },
        { currency: 'JPY', rate: '0.0067' },
        { currency: 'USD', rate: '3' },
      ],
    });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      base: 'USD',
      feePercent: '0.5',
      rates: [
        { currency: 'EUR', rate: '1.08' },
        { currency: 'JPY', rate: '0.0067' },
      ],
    });
    expect((await api.get('/exchange', bob)).body.rates).toHaveLength(2);
    const audit = await api.get('/admin/audit-logs?action=exchange.update', owner);
    expect(audit.body.items[0]).toMatchObject({ action: 'exchange.update' });
  });

  it('quotes take the fee first and round down', async () => {
    await api.deposit(bob, 'EUR', '1000.00');
    const eur = (await wallets(bob)).find((w) => w.currency === 'EUR')!;
    const toUsd = await api.post('/exchange/quote', bob, {
      fromWalletId: eur.id,
      toCurrency: 'USD',
      amount: '100',
    });
    expect(toUsd.body).toEqual({
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      amount: '100.00',
      fee: '0.50',
      receive: '107.46',
      rate: '1.08',
    });
    const toJpy = await api.post('/exchange/quote', bob, {
      fromWalletId: eur.id,
      toCurrency: 'JPY',
      amount: '100',
    });
    expect(toJpy.body).toMatchObject({ fee: '0.50', receive: '16038', rate: '161.194029' });

    const same = await api.post('/exchange/quote', bob, {
      fromWalletId: eur.id,
      toCurrency: 'EUR',
      amount: '1',
    });
    expect(same.status).toBe(400);
    const noRate = await api.post('/exchange/quote', bob, {
      fromWalletId: eur.id,
      toCurrency: 'GBP',
      amount: '1',
    });
    expect(noRate.status).toBe(400);
    const other = await api.post('/exchange/quote', founder, {
      fromWalletId: eur.id,
      toCurrency: 'USD',
      amount: '1',
    });
    expect(other.status).toBe(403);
  });

  it('exchanging moves money between two balances of the same owner', async () => {
    const eur = (await wallets(bob)).find((w) => w.currency === 'EUR')!;
    const done = await api.post('/exchange', bob, { fromWalletId: eur.id, toCurrency: 'USD', amount: '100' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ fromWalletId: eur.id, receive: '107.46', fee: '0.50' });
    const after = await wallets(bob);
    expect(after.find((w) => w.currency === 'EUR')!.balance).toBe('900.00');
    expect(after.find((w) => w.currency === 'USD')!.balance).toBe('107.46');

    const entries = await api.get(`/wallets/${eur.id}/entries`, bob);
    expect(entries.body.items[0]).toMatchObject({
      kind: 'exchange_out',
      amount: '-100.00',
      referenceType: 'exchange',
      referenceId: done.body.id,
    });
    const tooMuch = await api.post('/exchange', bob, {
      fromWalletId: eur.id,
      toCurrency: 'USD',
      amount: '5000',
    });
    expect(tooMuch.status).toBe(409);
  });

  it('removing a rate stops exchange into that currency', async () => {
    await api.put('/admin/exchange', manager, { rates: [{ currency: 'JPY', rate: null }] });
    const eur = (await wallets(bob)).find((w) => w.currency === 'EUR')!;
    const res = await api.post('/exchange/quote', bob, {
      fromWalletId: eur.id,
      toCurrency: 'JPY',
      amount: '1',
    });
    expect(res.status).toBe(400);
  });
});

describe('multi-signature company payments', () => {
  it('owners and directors set an approval limit once a second person can sign', async () => {
    const alone = await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '500' });
    expect(alone.status).toBe(400);
    await api.post(`/organizations/${orgId}/members`, founder, { username: 'counter', role: 'accountant' });
    expect((await api.patch(`/organizations/${orgId}`, accountant, { approvalLimit: '500' })).status).toBe(
      403,
    );
    const set = await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '500' });
    expect(set.status).toBe(200);
    expect(set.body.approvalLimit).toBe('500.00');
    // Only members see it.
    expect((await api.get('/organizations/nova-studio', bob)).body.approvalLimit).toBeNull();
    expect((await api.get('/organizations/nova-studio', accountant)).body.approvalLimit).toBe('500.00');
  });

  it('a transfer at the limit waits for a second finance member with the money set aside', async () => {
    await api.deposit({ ownerType: 'organization', ownerId: orgId }, 'USD', '2000.00');
    const usd = (await orgWallets(founder)).find((w) => w.currency === 'USD')!;

    const small = await api.post('/wallets/transfer', founder, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'bob' },
      amount: '100',
    });
    expect(small.status).toBe(200);

    const big = await api.post('/wallets/transfer', founder, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'bob' },
      amount: '500',
      note: 'Advance',
    });
    expect(big.status).toBe(202);
    expect(big.body).toMatchObject({
      kind: 'transfer',
      amount: '500.00',
      currency: 'USD',
      status: 'pending',
      description: 'Transfer 500.00 USD to @bob — Advance',
      requestedBy: { username: 'founder' },
    });
    expect((await orgWallets(founder)).find((w) => w.currency === 'USD')).toMatchObject({
      balance: '1900.00',
      frozen: '500.00',
      available: '1400.00',
    });

    const list = await api.get(`/organizations/${orgId}/payment-approvals?status=pending`, accountant);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([big.body.id]);
    expect((await api.get(`/organizations/${orgId}/payment-approvals`, bob)).status).toBe(403);

    const self = await api.post(`/organizations/${orgId}/payment-approvals/${big.body.id}/approve`, founder);
    expect(self.status).toBe(403);
    const signed = await api.post(
      `/organizations/${orgId}/payment-approvals/${big.body.id}/approve`,
      accountant,
    );
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ status: 'approved', decidedBy: { username: 'counter' } });
    expect((await orgWallets(founder)).find((w) => w.currency === 'USD')).toMatchObject({
      balance: '1400.00',
      frozen: '0.00',
    });
    expect((await wallets(bob)).find((w) => w.currency === 'USD')!.balance).toBe('707.46');
    const again = await api.post(
      `/organizations/${orgId}/payment-approvals/${big.body.id}/approve`,
      accountant,
    );
    expect(again.status).toBe(409);
  });

  it('declining releases the money; the requester may withdraw their own', async () => {
    const usd = (await orgWallets(founder)).find((w) => w.currency === 'USD')!;
    const big = await api.post('/wallets/transfer', accountant, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'bob' },
      amount: '900',
    });
    expect(big.status).toBe(202);
    const tooMuch = await api.post('/wallets/transfer', founder, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'bob' },
      amount: '600',
    });
    expect(tooMuch.status).toBe(409);
    const withdrawn = await api.post(
      `/organizations/${orgId}/payment-approvals/${big.body.id}/reject`,
      accountant,
      {
        reason: 'Wrong amount',
      },
    );
    expect(withdrawn.body).toMatchObject({ status: 'rejected', reason: 'Wrong amount' });
    expect((await orgWallets(founder)).find((w) => w.currency === 'USD')!.available).toBe('1400.00');
  });

  it('exchanges and invoice payments above the limit need a second signature too', async () => {
    const usd = (await orgWallets(founder)).find((w) => w.currency === 'USD')!;
    const fx = await api.post('/exchange', founder, {
      fromWalletId: usd.id,
      toCurrency: 'EUR',
      amount: '540',
    });
    expect(fx.status).toBe(202);
    expect(fx.body.description).toContain('Exchange 540.00 USD to EUR');
    await api.post(`/organizations/${orgId}/payment-approvals/${fx.body.id}/approve`, accountant);
    const eur = (await orgWallets(founder)).find((w) => w.currency === 'EUR')!;
    // 540 − 0.5% = 537.30 USD → 497.50 EUR (rounded down)
    expect(eur.balance).toBe('497.50');

    // A EUR payment is compared in USD: 470 EUR ≈ 507.60 USD.
    const invoice = await api.post('/invoices', bob, {
      from: { type: 'user' },
      to: { type: 'organization', slug: 'nova-studio' },
      currency: 'EUR',
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      items: [{ description: 'Artwork', quantity: 1, unitPrice: '470' }],
    });
    expect(invoice.status).toBe(201);
    const pay = await api.post(`/invoices/${invoice.body.id}/pay`, founder, { walletId: eur.id });
    expect(pay.status).toBe(202);
    const twice = await api.post(`/invoices/${invoice.body.id}/pay`, accountant, { walletId: eur.id });
    expect(twice.status).toBe(409);
    expect((await api.get(`/invoices/${invoice.body.id}`, founder)).body.status).toBe('open');
    const signed = await api.post(
      `/organizations/${orgId}/payment-approvals/${pay.body.id}/approve`,
      accountant,
    );
    expect(signed.status).toBe(200);
    const paid = (await api.get(`/invoices/${invoice.body.id}`, founder)).body;
    expect(paid).toMatchObject({ status: 'paid', paidBy: { username: 'founder' } });
    expect((await orgWallets(founder)).find((w) => w.currency === 'EUR')!.balance).toBe('27.50');
  });

  it('cancelling an invoice drops its waiting payment', async () => {
    await api.deposit({ ownerType: 'organization', ownerId: orgId }, 'USD', '1000.00');
    const usd = (await orgWallets(founder)).find((w) => w.currency === 'USD')!;
    const invoice = await api.post('/invoices', bob, {
      from: { type: 'user' },
      to: { type: 'organization', slug: 'nova-studio' },
      currency: 'USD',
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      items: [{ description: 'Music', quantity: 1, unitPrice: '800' }],
    });
    const pay = await api.post(`/invoices/${invoice.body.id}/pay`, founder, { walletId: usd.id });
    expect(pay.status).toBe(202);
    await api.post(`/invoices/${invoice.body.id}/cancel`, bob, { reason: 'Sent twice' });
    const [approval] = (await api.get(`/organizations/${orgId}/payment-approvals`, founder)).body;
    expect(approval).toMatchObject({
      id: pay.body.id,
      status: 'rejected',
      reason: 'The invoice was cancelled',
    });
    expect((await orgWallets(founder)).find((w) => w.currency === 'USD')!.frozen).toBe('0.00');
  });

  it('turning the limit off lets payments go straight through', async () => {
    await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '' });
    const usd = (await orgWallets(founder)).find((w) => w.currency === 'USD')!;
    const res = await api.post('/wallets/transfer', founder, {
      fromWalletId: usd.id,
      to: { type: 'user', username: 'bob' },
      amount: '1000',
    });
    expect(res.status).toBe(200);
  });
});
