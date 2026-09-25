import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let founder: Session;
let ann: Session;
let ben: Session;
let listingId: string;

const order = (as: Session, side: 'buy' | 'sell', shares: number, price: string) =>
  api.post('/stock/listings/NWS/orders', as, { side, shares, price });
const usd = async (s: Session) =>
  (await api.get('/wallets', s)).body.find((w: { currency: string }) => w.currency === 'USD') as {
    balance: string;
    frozen: string;
    available: string;
  };
const holding = async (s: Session) =>
  (await api.get('/stock/portfolio', s)).body.holdings.find((h: { ticker: string }) => h.ticker === 'NWS');

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  const moderator = await api.withRole('mod', 'moderator');
  founder = await api.register('founder');
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
  await api.post(`/applications/${res.body.id}/review`, moderator, { decision: 'approve', checklist: ALL_COMPANY_CHECKS });
  await api.post(`/applications/${res.body.id}/review`, owner, { decision: 'approve' });
  listingId = (await api.get('/stock/listings/NWS', null)).body.id;
  await api.deposit(ann, 'USD', '1000.00');
  await api.deposit(ben, 'USD', '200.00');
});
afterAll(() => app.close());

describe('secondary market', () => {
  it('shares from investments cannot be sold during the lock period', async () => {
    await api.post('/stock/listings/NWS/invest', ann, { amount: '100' });
    expect(await holding(ann)).toMatchObject({ shares: '20', locked: '20', sellable: '0', onSale: '0' });
    const early = await order(ann, 'sell', 5, '6');
    expect(early.status).toBe(409);
    await app.db.execute(sql`update investments set unlocks_at = now() - interval '1 day'`);
    expect(await holding(ann)).toMatchObject({ locked: '0', sellable: '20' });
  });

  it('orders rest in the book until a matching order arrives', async () => {
    const sell = await order(ann, 'sell', 10, '6');
    expect(sell.status).toBe(201);
    expect(sell.body).toMatchObject({ order: { side: 'sell', shares: '10', filled: '0', status: 'open' }, trades: [] });
    const low = await order(ben, 'buy', 4, '5.50');
    expect(low.body.trades).toEqual([]);
    expect(await usd(ben)).toMatchObject({ balance: '200.00', frozen: '22.00', available: '178.00' });

    const book = await api.get('/stock/listings/NWS/book', null);
    expect(book.body).toMatchObject({
      bids: [{ price: '5.50', shares: '4', orders: 1 }],
      asks: [{ price: '6.00', shares: '10', orders: 1 }],
      lastPrice: '5.00',
      trades: [],
    });
    expect(await holding(ann)).toMatchObject({ shares: '20', onSale: '10', sellable: '10' });
  });

  it('a crossing order trades at the resting price, best price first', async () => {
    const buy = await order(ben, 'buy', 5, '6.50');
    expect(buy.body.order).toMatchObject({ status: 'filled', filled: '5' });
    expect(buy.body.trades).toMatchObject([{ price: '6.00', shares: '5', side: 'buy' }]);
    // Ben paid 6.00 a share, not his 6.50 limit.
    expect(await usd(ben)).toMatchObject({ balance: '170.00', frozen: '22.00' });
    expect((await usd(ann)).balance).toBe('930.00');
    expect(await holding(ben)).toMatchObject({ shares: '5', sellable: '5', invested: '30.00' });
    expect((await api.get('/stock/listings/NWS', null)).body.sharePrice).toBe('6.00');

    // Selling into the resting bid.
    const sell = await order(ann, 'sell', 6, '5.50');
    expect(sell.body.trades).toMatchObject([{ price: '5.50', shares: '4', side: 'sell' }]);
    expect(sell.body.order).toMatchObject({ status: 'open', filled: '4', remaining: '2' });
    expect(await usd(ben)).toMatchObject({ balance: '148.00', frozen: '0.00' });
    expect(await holding(ben)).toMatchObject({ shares: '9', invested: '52.00' });
    expect(await holding(ann)).toMatchObject({ shares: '11', onSale: '7', sellable: '4' });

    const book = await api.get('/stock/listings/NWS/book', null);
    expect(book.body.bids).toEqual([]);
    expect(book.body.asks).toEqual([
      { price: '5.50', shares: '2', orders: 1 },
      { price: '6.00', shares: '5', orders: 1 },
    ]);
    expect(book.body.lastPrice).toBe('5.50');
    expect(book.body.trades.map((t: { price: string }) => t.price)).toEqual(['5.50', '6.00']);
    const entries = await api.get(`/stock/listings/NWS`, null);
    expect(entries.body.priceHistory.at(-1).price).toBe('5.50');
  });

  it('nobody trades with themselves; cancelling releases the hold', async () => {
    const own = await order(ann, 'buy', 2, '7');
    expect(own.body.trades).toEqual([]);
    expect((await usd(ann)).frozen).toBe('14.00');
    const cancelled = await api.del(`/stock/orders/${own.body.order.id}`, ann);
    expect(cancelled.body).toMatchObject({ status: 'cancelled' });
    expect((await usd(ann)).frozen).toBe('0.00');
    expect((await api.del(`/stock/orders/${own.body.order.id}`, ann)).status).toBe(409);
    expect((await api.del(`/stock/orders/${own.body.order.id}`, ben)).status).toBe(404);
    const mine = await api.get('/stock/orders?status=open', ann);
    expect(mine.body.map((o: { price: string }) => o.price)).toEqual(['5.50', '6.00']);
  });

  it('checks money, shares and the listing status', async () => {
    expect((await order(ben, 'buy', 1000, '5')).status).toBe(409);
    expect((await order(ben, 'sell', 50, '5')).status).toBe(409);
    await app.db.execute(sql`update stock_listings set status = 'halted' where id = ${listingId}`);
    expect((await order(ben, 'buy', 1, '5')).status).toBe(409);
    await app.db.execute(sql`update stock_listings set status = 'active' where id = ${listingId}`);
  });
});
