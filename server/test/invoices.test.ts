import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let founder: Session;
let accountant: Session;
let member: Session;
let bob: Session;
let eve: Session;
let orgId: string;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const year = new Date().getUTCFullYear();

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  const owner = await api.owner();
  const moderator = await api.withRole('mod', 'moderator');
  founder = await api.register('founder');
  accountant = await api.register('counter');
  member = await api.register('intern');
  bob = await api.register('bob');
  eve = await api.register('eve');

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
  await api.post(`/organizations/${orgId}/members`, founder, { username: 'counter', role: 'accountant' });
  await api.post(`/organizations/${orgId}/members`, founder, { username: 'intern', role: 'member' });
});
afterAll(() => app.close());

const invoice = (as: Session, body: Record<string, unknown>) =>
  api.post('/invoices', as, {
    from: { type: 'organization', organizationId: orgId },
    to: { type: 'user', username: 'bob' },
    currency: 'USD',
    dueDate: inDays(14),
    items: [
      { description: 'Level design', quantity: 2, unitPrice: '150' },
      { description: 'Sound pack', quantity: 1, unitPrice: '49.99' },
    ],
    ...body,
  });

describe('invoices', () => {
  let first: { id: string; number: string };
  let second: { id: string; number: string };

  it('companies invoice people with numbered invoices both sides can see', async () => {
    const created = await invoice(founder, { note: 'Thanks for the order!' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      number: `INV-${year}-0001`,
      direction: 'outgoing',
      issuer: { type: 'organization', name: 'Nova Studio', handle: 'nova-studio' },
      recipient: { type: 'user', name: 'Bob', handle: '@bob' },
      total: '349.99',
      status: 'open',
      overdue: false,
      items: [
        { description: 'Level design', quantity: 2, unitPrice: '150.00', amount: '300.00' },
        { description: 'Sound pack', quantity: 1, unitPrice: '49.99', amount: '49.99' },
      ],
    });
    first = created.body;

    // The accountant numbers the next one; numbers are per issuer.
    second = (await invoice(accountant, {})).body;
    expect(second.number).toBe(`INV-${year}-0002`);
    const personal = await api.post('/invoices', eve, {
      from: { type: 'user' },
      to: { type: 'user', username: 'bob' },
      currency: 'EUR',
      dueDate: inDays(0),
      items: [{ description: 'Consulting', quantity: 3, unitPrice: '80' }],
    });
    expect(personal.body.number).toBe(`INV-${year}-0001`);

    const incoming = await api.get('/invoices?direction=incoming', bob);
    expect(incoming.body.map((i: { number: string; direction: string }) => [i.number, i.direction])).toEqual([
      [`INV-${year}-0001`, 'incoming'],
      [`INV-${year}-0002`, 'incoming'],
      [`INV-${year}-0001`, 'incoming'],
    ]);
    expect((await api.get('/invoices?direction=outgoing', bob)).body).toEqual([]);
    expect((await api.get(`/invoices/${first.id}`, accountant)).body.direction).toBe('outgoing');
    // People outside both sides (and company members without a finance role) cannot see it.
    expect((await api.get(`/invoices/${first.id}`, eve)).status).toBe(404);
    expect((await api.get(`/invoices/${first.id}`, member)).status).toBe(404);
  });

  it('checks who may issue and what', async () => {
    expect((await invoice(member, {})).status).toBe(403);
    expect((await invoice(bob, {})).status).toBe(403);
    expect((await invoice(founder, { dueDate: inDays(-1) })).status).toBe(400);
    expect((await invoice(founder, { to: { type: 'organization', slug: 'nova-studio' } })).status).toBe(400);
    expect((await invoice(founder, { to: { type: 'user', username: 'nobody_here' } })).status).toBe(404);
    expect(
      (await invoice(founder, { items: [{ description: 'Free sample', quantity: 1, unitPrice: '0' }] }))
        .status,
    ).toBe(400);
    expect((await invoice(founder, { currency: 'JPY' })).status).toBe(400); // 49.99 has decimals
    expect((await invoice(founder, { currency: 'XXX' })).status).toBe(400);
  });

  it('the recipient pays in full from a balance in the invoice currency', async () => {
    await api.deposit(bob, 'EUR', '1000.00');
    const eur = (await api.get('/wallets', bob)).body.find((w: { currency: string }) => w.currency === 'EUR');
    expect((await api.post(`/invoices/${first.id}/pay`, bob, { walletId: eur.id })).status).toBe(400);

    await api.deposit(bob, 'USD', '300.00');
    const usd = (await api.get('/wallets', bob)).body.find((w: { currency: string }) => w.currency === 'USD');
    expect((await api.post(`/invoices/${first.id}/pay`, bob, { walletId: usd.id })).status).toBe(409);
    // Only the recipient's balances, and only people who can move them.
    const founderUsd = (await api.deposit(founder, 'USD', '1000.00')).walletId as string;
    expect((await api.post(`/invoices/${first.id}/pay`, founder, { walletId: founderUsd })).status).toBe(400);
    expect((await api.post(`/invoices/${first.id}/pay`, eve, { walletId: usd.id })).status).toBe(404);

    await api.deposit(bob, 'USD', '100.00');
    const paid = await api.post(`/invoices/${first.id}/pay`, bob, { walletId: usd.id });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paidBy: { username: 'bob' } });
    expect((await api.get(`/wallets/${usd.id}`, bob)).body.balance).toBe('50.01');

    const company = (await api.get(`/organizations/${orgId}/wallets`, founder)).body;
    expect(company.find((w: { currency: string }) => w.currency === 'USD').balance).toBe('349.99');
    const entries = (await api.get(`/wallets/${usd.id}/entries`, bob)).body.items;
    expect(entries[0]).toMatchObject({
      kind: 'transfer_out',
      amount: '-349.99',
      description: `Invoice INV-${year}-0001 from Nova Studio`,
      referenceType: 'invoice',
      referenceId: first.id,
    });

    expect((await api.post(`/invoices/${first.id}/pay`, bob, { walletId: usd.id })).status).toBe(409);
    expect((await api.post(`/invoices/${first.id}/cancel`, founder, {})).status).toBe(409);
  });

  it('only the issuer cancels an open invoice', async () => {
    expect((await api.post(`/invoices/${second.id}/cancel`, bob, {})).status).toBe(403);
    const cancelled = await api.post(`/invoices/${second.id}/cancel`, accountant, { reason: 'Sent twice' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Sent twice' });
    expect((await api.get('/invoices?direction=incoming&status=open', bob)).body).toHaveLength(1);
  });

  it('companies pay invoices from their business balance', async () => {
    const bill = await api.post('/invoices', bob, {
      from: { type: 'user' },
      to: { type: 'organization', slug: 'nova-studio' },
      currency: 'USD',
      dueDate: inDays(7),
      items: [{ description: 'Voice acting', quantity: 1, unitPrice: '120.50' }],
    });
    expect(bill.status).toBe(201);
    const companyUsd = (await api.get(`/organizations/${orgId}/wallets`, founder)).body.find(
      (w: { currency: string }) => w.currency === 'USD',
    );
    expect(
      (await api.post(`/invoices/${bill.body.id}/pay`, member, { walletId: companyUsd.id })).status,
    ).toBe(404);
    const paid = await api.post(`/invoices/${bill.body.id}/pay`, accountant, { walletId: companyUsd.id });
    expect(paid.body).toMatchObject({
      status: 'paid',
      direction: 'incoming',
      paidBy: { username: 'counter' },
    });
    expect((await api.get(`/organizations/${orgId}/wallets`, founder)).body[0].balance).toBe('229.49');
  });

  it('refuses payments to a suspended issuer', async () => {
    const bill = await api.post('/invoices', eve, {
      from: { type: 'user' },
      to: { type: 'user', username: 'bob' },
      currency: 'USD',
      dueDate: inDays(7),
      items: [{ description: 'Proofreading', quantity: 1, unitPrice: '10' }],
    });
    const owner = await api.owner();
    await api.patch(`/admin/users/${eve.id}`, owner, { status: 'suspended' });
    const usd = (await api.get('/wallets', bob)).body.find((w: { currency: string }) => w.currency === 'USD');
    const paid = await api.post(`/invoices/${bill.body.id}/pay`, bob, { walletId: usd.id });
    expect(paid.status).toBe(409);
    expect((await api.get(`/wallets/${usd.id}`, bob)).body.balance).toBe('170.51');
  });
});
