import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let manager: Session;
let other: Session;
let alice: Session;
let bob: Session;
let walletId: string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  manager = await api.withRole('cashier', 'manager');
  other = await api.withRole('teller', 'manager');
  alice = await api.register('alice');
  bob = await api.register('bob');
  await api.deposit(alice, 'EUR', '500.00');
  walletId = (await api.get('/wallets', alice)).body[0].id;
});
afterAll(() => app.close());

const wallet = async () => (await api.get(`/wallets/${walletId}`, alice)).body;
const request = (body: Record<string, string>, as = alice) =>
  api.post(`/wallets/${walletId}/cash-requests`, as, { method: 'manager_transfer', ...body });

describe('deposit and payout requests', () => {
  it('holds the amount of a payout until it is handled', async () => {
    expect((await request({ type: 'withdrawal', amount: '600' })).status).toBe(409);
    expect((await request({ type: 'withdrawal', amount: '10' }, bob)).status).toBe(403);

    const payout = await request({ type: 'withdrawal', amount: '200', note: 'Supplier invoice 17' });
    expect(payout.status).toBe(201);
    expect(payout.body).toMatchObject({
      type: 'withdrawal',
      status: 'pending',
      amount: '200.00',
      currency: 'EUR',
      ownerName: 'Alice',
      requestedBy: { username: 'alice' },
      handledBy: null,
    });
    expect(await wallet()).toMatchObject({ balance: '500.00', frozen: '200.00', available: '300.00' });
    // The held money cannot be spent twice.
    expect((await request({ type: 'withdrawal', amount: '301' })).status).toBe(409);

    const queue = await api.get('/admin/cash-requests?status=pending', manager);
    expect(queue.body.map((r: { id: string }) => r.id)).toEqual([payout.body.id]);
    expect((await api.get('/admin/stats', manager)).body.pendingCashRequests).toBe(1);
    expect((await api.get('/admin/cash-requests', alice)).status).toBe(403);

    const paid = await api.post(`/admin/cash-requests/${payout.body.id}/complete`, manager, {
      reference: 'SEPA-9001',
    });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({
      status: 'completed',
      reference: 'SEPA-9001',
      handledBy: { username: 'cashier' },
    });
    expect(await wallet()).toMatchObject({ balance: '300.00', frozen: '0.00', available: '300.00' });
    const entries = (await api.get(`/wallets/${walletId}/entries`, alice)).body.items;
    expect(entries[0]).toMatchObject({ kind: 'withdrawal', amount: '-200.00', balanceAfter: '300.00' });

    // Handled requests cannot be handled again.
    const again = await api.post(`/admin/cash-requests/${payout.body.id}/decline`, manager, {
      reason: 'Too late',
    });
    expect(again.status).toBe(409);
  });

  it('credits deposits and keeps managers from handling their own requests', async () => {
    const managerWallet = (await api.deposit(manager, 'EUR', '1.00')).walletId as string;
    const own = await api.post(`/wallets/${managerWallet}/cash-requests`, manager, {
      type: 'deposit',
      method: 'physical_cash',
      amount: '50',
    });
    expect(own.status).toBe(201);
    const self = await api.post(`/admin/cash-requests/${own.body.id}/complete`, manager, {
      reference: 'R-1',
    });
    expect(self.status).toBe(403);
    expect(
      (await api.post(`/admin/cash-requests/${own.body.id}/complete`, other, { reference: 'R-1' })).status,
    ).toBe(200);

    const deposit = await request({ type: 'deposit', amount: '75.50' });
    expect(await wallet()).toMatchObject({ balance: '300.00', frozen: '0.00' });
    await api.post(`/admin/cash-requests/${deposit.body.id}/complete`, manager, { reference: 'BANK-5' });
    expect((await wallet()).balance).toBe('375.50');
  });

  it('releases the hold when a payout is declined or cancelled', async () => {
    const declined = await request({ type: 'withdrawal', amount: '100' });
    const cancelled = await request({ type: 'withdrawal', amount: '50' });
    expect((await wallet()).available).toBe('225.50');

    const decline = await api.post(`/admin/cash-requests/${declined.body.id}/decline`, manager, {
      reason: 'Bank details are missing',
    });
    expect(decline.body).toMatchObject({ status: 'declined', declineReason: 'Bank details are missing' });
    expect((await api.post(`/cash-requests/${cancelled.body.id}/cancel`, bob)).status).toBe(403);
    expect((await api.post(`/cash-requests/${cancelled.body.id}/cancel`, alice)).body.status).toBe(
      'cancelled',
    );
    expect(await wallet()).toMatchObject({ balance: '375.50', frozen: '0.00', available: '375.50' });

    const mine = await api.get(`/wallets/${walletId}/cash-requests`, alice);
    expect(mine.body.map((r: { status: string }) => r.status)).toEqual([
      'cancelled',
      'declined',
      'completed',
      'completed',
    ]);
  });

  it('exports the statement as CSV', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/wallets/${walletId}/statement.csv`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="ovl-statement-eur-/);
    const lines = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Date,Operation,Description,Amount,Balance after,Currency,Entry');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(',deposit,');
    expect(lines[2]).toContain(
      ',withdrawal,Withdrawal via manager transfer (ref. SEPA-9001),-200.00,300.00,EUR,',
    );
    expect(lines[3]).toContain(',375.50,EUR,');

    const future = await app.inject({
      method: 'GET',
      url: `/api/v1/wallets/${walletId}/statement.csv?from=2999-01-01`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(future.body.trim().split('\r\n')).toHaveLength(1);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/wallets/${walletId}/statement.csv`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('gives apps a short-lived download link that needs no Authorization header', async () => {
    const link = await api.post(`/wallets/${walletId}/statement-link`, alice, { from: '2000-01-01' });
    expect(link.status).toBe(200);
    expect(link.body.path).toMatch(new RegExp(`^/api/v1/wallets/${walletId}/statement\\.csv\\?link=`));
    expect(Date.parse(link.body.expiresAt) - Date.now()).toBeGreaterThan(4 * 60_000);
    expect((await api.post(`/wallets/${walletId}/statement-link`, bob, {})).status).toBe(403);

    const open = await app.inject({ method: 'GET', url: link.body.path });
    expect(open.statusCode).toBe(200);
    expect(open.body).toContain('SEPA-9001');

    const token = new URL(link.body.path, 'http://x').searchParams.get('link')!;
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/wallets/${walletId}/statement.csv?link=${tampered}`,
    });
    expect(bad.statusCode).toBe(401);
    // The link is for one wallet only, and it is not an access token.
    const bobWallet = (await api.deposit(bob, 'EUR', '5.00')).walletId as string;
    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/wallets/${bobWallet}/statement.csv?link=${token}`,
    });
    expect(other.statusCode).toBe(401);
    const asBearer = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asBearer.statusCode).toBe(401);

    // Signing the session out ends its links too.
    const session = await api.login('alice', 'password-123');
    const fresh = await api.post(`/wallets/${walletId}/statement-link`, session, {});
    const mine = (await api.get('/me/sessions', alice)).body as { id: string; current: boolean }[];
    for (const s of mine.filter((s) => !s.current)) await api.del(`/me/sessions/${s.id}`, alice);
    expect((await app.inject({ method: 'GET', url: fresh.body.path })).statusCode).toBe(401);
  });
});
