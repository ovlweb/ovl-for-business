import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, nthRun, runDueSchedules } from '../src/modules/invoice-schedules';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let founder: Session;
let accountant: Session;
let bob: Session;
let carol: Session;
let orgId: string;

const day = (offset = 0) => addDays(new Date().toISOString().slice(0, 10), offset);

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  const owner = await api.owner();
  const moderator = await api.withRole('mod', 'moderator');
  founder = await api.register('founder');
  accountant = await api.register('counter');
  bob = await api.register('bob');
  carol = await api.register('carol');
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
  await api.deposit({ ownerType: 'organization', ownerId: orgId }, 'USD', '5000.00');
  await api.deposit(bob, 'USD', '1000.00');
});
afterAll(() => app.close());

const orgUsd = async () =>
  (await api.get(`/organizations/${orgId}/wallets`, founder)).body.find(
    (w: { currency: string }) => w.currency === 'USD',
  ) as { id: string; balance: string; frozen: string; available: string };
const bobUsd = async () =>
  (await api.get('/wallets', bob)).body.find((w: { currency: string }) => w.currency === 'USD') as {
    id: string;
    balance: string;
  };

describe('partial invoice payments', () => {
  it('an invoice can be paid in parts until nothing is due', async () => {
    const invoice = await api.post('/invoices', founder, {
      from: { type: 'organization', organizationId: orgId },
      to: { type: 'user', username: 'bob' },
      currency: 'USD',
      dueDate: day(14),
      items: [{ description: 'Season pass', quantity: 1, unitPrice: '300' }],
    });
    const id = invoice.body.id;
    const wallet = await bobUsd();

    const first = await api.post(`/invoices/${id}/pay`, bob, { walletId: wallet.id, amount: '100' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: 'open',
      amountPaid: '100.00',
      amountDue: '200.00',
      paidAt: null,
    });
    expect(first.body.payments).toMatchObject([{ amount: '100.00', paidBy: { username: 'bob' } }]);

    const tooMuch = await api.post(`/invoices/${id}/pay`, bob, { walletId: wallet.id, amount: '250' });
    expect(tooMuch.status).toBe(409);
    const cancel = await api.post(`/invoices/${id}/cancel`, founder, {});
    expect(cancel.status).toBe(409);

    const rest = await api.post(`/invoices/${id}/pay`, bob, { walletId: wallet.id });
    expect(rest.body).toMatchObject({ status: 'paid', amountPaid: '300.00', amountDue: '0.00' });
    expect(rest.body.payments).toHaveLength(2);
    expect((await bobUsd()).balance).toBe('700.00');
    const entries = await api.get(`/wallets/${wallet.id}/entries`, bob);
    expect(entries.body.items[0].description).toBe(
      `Invoice ${invoice.body.number} from Nova Studio (final part)`,
    );
    expect(entries.body.items[1].description).toBe(`Invoice ${invoice.body.number} from Nova Studio (part)`);
  });
});

describe('recurring invoices', () => {
  it('months are counted from the start day and never drift', () => {
    expect(nthRun('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(nthRun('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(nthRun('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
    expect(nthRun('2026-11-15', 'quarterly', 1)).toBe('2027-02-15');
    expect(nthRun('2026-05-01', 'weekly', 3)).toBe('2026-05-22');
    expect(nthRun('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
  });

  let scheduleId: string;

  it('starting today sends the first invoice at once and plans the next', async () => {
    const created = await api.post('/invoice-schedules', founder, {
      from: { type: 'organization', organizationId: orgId },
      to: { type: 'user', username: 'bob' },
      currency: 'USD',
      interval: 'monthly',
      startDate: day(),
      dueDays: 10,
      items: [{ description: 'Hosting', quantity: 1, unitPrice: '25' }],
    });
    expect(created.status).toBe(201);
    scheduleId = created.body.id;
    expect(created.body).toMatchObject({
      interval: 'monthly',
      status: 'active',
      invoiceCount: 1,
      total: '25.00',
      nextRunOn: nthRun(day(), 'monthly', 1),
      recipient: { handle: '@bob' },
    });
    const incoming = await api.get('/invoices?direction=incoming', bob);
    const latest = incoming.body[0];
    expect(latest).toMatchObject({
      total: '25.00',
      dueDate: day(10),
      recurring: { scheduleId, interval: 'monthly' },
    });
    expect((await api.get('/invoice-schedules', bob)).body).toEqual([]);
    expect((await api.get('/invoice-schedules', accountant)).body).toHaveLength(1);
  });

  it('the job issues each period once, even when it runs twice', async () => {
    const next = nthRun(day(), 'monthly', 1);
    const [a, b] = await Promise.all([
      runDueSchedules(app, { day: next }),
      runDueSchedules(app, { day: next }),
    ]);
    expect(a.length + b.length).toBe(1);
    expect((await runDueSchedules(app, { day: next })).length).toBe(0);
    const [schedule] = (await api.get('/invoice-schedules', founder)).body;
    expect(schedule).toMatchObject({ invoiceCount: 2, nextRunOn: nthRun(day(), 'monthly', 2) });
  });

  it('paused schedules send nothing; ending is final', async () => {
    const paused = await api.patch(`/invoice-schedules/${scheduleId}`, accountant, { status: 'paused' });
    expect(paused.body.status).toBe('paused');
    expect((await runDueSchedules(app, { day: nthRun(day(), 'monthly', 5) })).length).toBe(0);
    expect((await api.patch(`/invoice-schedules/${scheduleId}`, bob, { status: 'active' })).status).toBe(403);
    const resumed = await api.patch(`/invoice-schedules/${scheduleId}`, founder, { status: 'active' });
    expect(resumed.body).toMatchObject({ status: 'active', nextRunOn: nthRun(day(), 'monthly', 2) });
    const ended = await api.patch(`/invoice-schedules/${scheduleId}`, founder, { status: 'ended' });
    expect(ended.body).toMatchObject({ status: 'ended', nextRunOn: null });
    expect((await api.patch(`/invoice-schedules/${scheduleId}`, founder, { status: 'active' })).status).toBe(
      409,
    );
  });

  it('a schedule with an end date stops by itself', async () => {
    const start = day(1);
    const created = await api.post('/invoice-schedules', bob, {
      from: { type: 'user' },
      to: { type: 'user', username: 'carol' },
      currency: 'USD',
      interval: 'weekly',
      startDate: start,
      endDate: addDays(start, 10),
      items: [{ description: 'Lessons', quantity: 2, unitPrice: '15' }],
    });
    expect(created.body).toMatchObject({ invoiceCount: 0, nextRunOn: start });
    const issued = await runDueSchedules(app, { day: addDays(start, 30) });
    expect(issued.filter((i) => i.scheduleId === created.body.id)).toHaveLength(2);
    const [mine] = (await api.get('/invoice-schedules', bob)).body;
    expect(mine).toMatchObject({ status: 'ended', invoiceCount: 2, nextRunOn: null });
    expect((await api.get('/invoices?direction=incoming', carol)).body).toHaveLength(2);
  });
});

describe('payroll', () => {
  it('a company pays several people at once', async () => {
    const wallet = await orgUsd();
    const run = await api.post(`/organizations/${orgId}/payroll`, founder, {
      walletId: wallet.id,
      title: 'Salaries — March',
      items: [
        { username: 'bob', amount: '400', note: 'Level design' },
        { username: 'carol', amount: '350.50' },
      ],
    });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      status: 'paid',
      total: '750.50',
      items: [
        { user: { username: 'bob' }, amount: '400.00', note: 'Level design' },
        { user: { username: 'carol' }, amount: '350.50', note: '' },
      ],
    });
    const carolWallets = (await api.get('/wallets', carol)).body;
    expect(carolWallets.find((w: { currency: string }) => w.currency === 'USD').balance).toBe('350.50');
    const entries = await api.get(`/wallets/${wallet.id}/entries`, founder);
    expect(entries.body.items[0]).toMatchObject({
      kind: 'payroll_out',
      amount: '-750.50',
      description: 'Payroll: Salaries — March (2 people)',
    });
    const bobEntries = await api.get(`/wallets/${(await bobUsd()).id}/entries`, bob);
    expect(bobEntries.body.items[0]).toMatchObject({
      kind: 'payroll_in',
      description: 'Nova Studio: Salaries — March — Level design',
    });
    expect((await api.get(`/organizations/${orgId}/payroll`, accountant)).body).toHaveLength(1);
    expect((await api.get(`/organizations/${orgId}/payroll`, bob)).status).toBe(403);
  });

  it('rejects unknown people, duplicates and more than the balance', async () => {
    const wallet = await orgUsd();
    const pay = (items: unknown[]) =>
      api.post(`/organizations/${orgId}/payroll`, founder, { walletId: wallet.id, title: 'Bonus', items });
    expect((await pay([{ username: 'nobody', amount: '1' }])).status).toBe(400);
    expect(
      (
        await pay([
          { username: 'bob', amount: '1' },
          { username: 'bob', amount: '2' },
        ])
      ).status,
    ).toBe(400);
    expect((await pay([{ username: 'bob', amount: '99999' }])).status).toBe(409);
    expect((await api.get(`/organizations/${orgId}/payroll`, founder)).body).toHaveLength(1);
  });

  it('above the approval limit a run waits for a second signature', async () => {
    await api.patch(`/organizations/${orgId}`, founder, { approvalLimit: '1000' });
    const wallet = await orgUsd();
    const run = await api.post(`/organizations/${orgId}/payroll`, founder, {
      walletId: wallet.id,
      title: 'Salaries — April',
      items: [
        { username: 'bob', amount: '600' },
        { username: 'carol', amount: '600' },
      ],
    });
    expect(run.status).toBe(202);
    expect(run.body).toMatchObject({ status: 'pending', total: '1200.00' });
    expect((await orgUsd()).frozen).toBe('1200.00');

    const signed = await api.post(
      `/organizations/${orgId}/payment-approvals/${run.body.approvalId}/approve`,
      accountant,
    );
    expect(signed.status).toBe(200);
    const [latest] = (await api.get(`/organizations/${orgId}/payroll`, founder)).body;
    expect(latest).toMatchObject({ id: run.body.id, status: 'paid' });
    expect((await orgUsd()).frozen).toBe('0.00');

    const declined = await api.post(`/organizations/${orgId}/payroll`, founder, {
      walletId: wallet.id,
      title: 'Salaries — May',
      items: [{ username: 'bob', amount: '1500' }],
    });
    await api.post(
      `/organizations/${orgId}/payment-approvals/${declined.body.approvalId}/reject`,
      accountant,
      {
        reason: 'Budget not approved',
      },
    );
    const [may] = (await api.get(`/organizations/${orgId}/payroll`, founder)).body;
    expect(may).toMatchObject({ title: 'Salaries — May', status: 'rejected' });
  });

  it('a partial invoice payment above the limit is approved for that part only', async () => {
    const invoice = await api.post('/invoices', bob, {
      from: { type: 'user' },
      to: { type: 'organization', slug: 'nova-studio' },
      currency: 'USD',
      dueDate: day(7),
      items: [{ description: 'Artwork', quantity: 1, unitPrice: '2000' }],
    });
    const wallet = await orgUsd();
    const small = await api.post(`/invoices/${invoice.body.id}/pay`, founder, {
      walletId: wallet.id,
      amount: '500',
    });
    expect(small.status).toBe(200);
    expect(small.body.amountDue).toBe('1500.00');
    const big = await api.post(`/invoices/${invoice.body.id}/pay`, founder, {
      walletId: wallet.id,
      amount: '1200',
    });
    expect(big.status).toBe(202);
    expect(big.body).toMatchObject({
      amount: '1200.00',
      description: `Invoice ${invoice.body.number} from Bob (part: 1200.00 of 1500.00 USD due)`,
    });
    await api.post(`/organizations/${orgId}/payment-approvals/${big.body.id}/approve`, accountant);
    const part = (await api.get(`/invoices/${invoice.body.id}`, founder)).body;
    expect(part).toMatchObject({ status: 'open', amountPaid: '1700.00', amountDue: '300.00' });
    const rest = await api.post(`/invoices/${invoice.body.id}/pay`, founder, { walletId: wallet.id });
    expect(rest.status).toBe(200);
    const paid = (await api.get(`/invoices/${invoice.body.id}`, founder)).body;
    expect(paid).toMatchObject({ status: 'paid', amountPaid: '2000.00' });
  });
});
