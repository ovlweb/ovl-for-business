import { formatAmount, type StockOrder, type StockTrade } from '@ovl/shared';
import { and, asc, desc, eq, gt, gte, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  fundLocks,
  investments,
  shareholdings,
  stockListings,
  stockOrders,
  stockPriceHistory,
  stockTrades,
} from '../../db/schema';
import { badRequest, conflict, insufficientFunds } from '../../lib/errors';
import { iso } from '../../lib/mappers';
import { credit, debit, frozenAmounts, getOrCreateWallet, lockWallet } from '../wallets/service';
import type { ListingRow } from './service';
import { text } from '../../lib/i18n';

type OrderRow = typeof stockOrders.$inferSelect;
type TradeRow = typeof stockTrades.$inferSelect;

/** Buy orders hold their money until filled or cancelled. */
export const ORDER_HOLD = 'stock_order';
const HOLD_UNTIL = new Date('2100-01-01T00:00:00Z');

export const orderDto = (o: OrderRow, listing: Pick<ListingRow, 'ticker' | 'currency'>): StockOrder => ({
  id: o.id,
  ticker: listing.ticker,
  currency: listing.currency,
  side: o.side,
  price: formatAmount(o.price, listing.currency),
  shares: o.shares.toString(),
  filled: o.filled.toString(),
  remaining: (o.shares - o.filled).toString(),
  status: o.status,
  createdAt: iso(o.createdAt),
  updatedAt: iso(o.updatedAt),
});

export const tradeDto = (t: TradeRow, currency: string): StockTrade => ({
  id: t.id,
  price: formatAmount(t.price, currency),
  shares: t.shares.toString(),
  side: t.takerSide,
  at: iso(t.createdAt),
});

/** Add (or remove, with a negative number) shares to a holding. */
export async function addShares(db: Db, listingId: string, userId: string, shares: bigint) {
  if (shares < 0n) {
    // (An upsert would check the constraint on the negative insert row first.)
    const updated = await db
      .update(shareholdings)
      .set({ shares: sql`${shareholdings.shares} + ${shares.toString()}::bigint`, updatedAt: new Date() })
      .where(and(eq(shareholdings.listingId, listingId), eq(shareholdings.userId, userId)))
      .returning({ shares: shareholdings.shares });
    if (!updated.length) throw conflict('No shares to take');
    return;
  }
  await db
    .insert(shareholdings)
    .values({ listingId, userId, shares })
    .onConflictDoUpdate({
      target: [shareholdings.listingId, shareholdings.userId],
      set: { shares: sql`${shareholdings.shares} + ${shares.toString()}::bigint`, updatedAt: new Date() },
    });
}

/** A person's position in one listing: what they hold, what is locked and what is on sale. */
export async function position(db: Db, listingId: string, userId: string, now = new Date()) {
  const [[held], [locked], [onSale]] = await Promise.all([
    db
      .select({ shares: shareholdings.shares })
      .from(shareholdings)
      .where(and(eq(shareholdings.listingId, listingId), eq(shareholdings.userId, userId))),
    db
      .select({ n: sql<string>`coalesce(sum(${investments.shares}), 0)` })
      .from(investments)
      .where(
        and(
          eq(investments.listingId, listingId),
          eq(investments.investorId, userId),
          gt(investments.unlocksAt, now),
        ),
      ),
    db
      .select({ n: sql<string>`coalesce(sum(${stockOrders.shares} - ${stockOrders.filled}), 0)` })
      .from(stockOrders)
      .where(
        and(
          eq(stockOrders.listingId, listingId),
          eq(stockOrders.userId, userId),
          eq(stockOrders.side, 'sell'),
          eq(stockOrders.status, 'open'),
        ),
      ),
  ]);
  const shares = held?.shares ?? 0n;
  const lockedShares = BigInt(locked?.n ?? 0) > shares ? shares : BigInt(locked?.n ?? 0);
  const selling = BigInt(onSale?.n ?? 0);
  const sellable = shares - lockedShares - selling;
  return { shares, locked: lockedShares, onSale: selling, sellable: sellable > 0n ? sellable : 0n };
}

/** Move money and shares for one match; the trade happens at the resting order's price. */
async function executeTrade(
  tx: Db,
  listing: ListingRow,
  buy: OrderRow,
  sell: OrderRow,
  shares: bigint,
  price: bigint,
  takerSide: 'buy' | 'sell',
) {
  const amount = shares * price;
  for (const id of [buy.walletId, sell.walletId].sort()) await lockWallet(tx, id);
  // The buyer reserved their own limit price for these shares; the rest of the hold stays.
  await tx
    .update(fundLocks)
    .set({ amount: sql`${fundLocks.amount} - ${(shares * buy.price).toString()}::bigint` })
    .where(and(eq(fundLocks.reason, ORDER_HOLD), eq(fundLocks.referenceId, buy.id)));
  const [trade] = await tx
    .insert(stockTrades)
    .values({
      listingId: listing.id,
      buyOrderId: buy.id,
      sellOrderId: sell.id,
      buyerId: buy.userId,
      sellerId: sell.userId,
      takerSide,
      price,
      shares,
    })
    .returning();
  const reference = { referenceType: 'stock_trade', referenceId: trade!.id };
  const at = `${formatAmount(price, listing.currency)} ${listing.currency}`;
  await debit(tx, buy.walletId, amount, 'trade_out', {
    ...reference,
    actorId: buy.userId,
    description: `Bought ${shares} ${listing.ticker} at ${at}`,
    counterpartyWalletId: sell.walletId,
  });
  await credit(tx, sell.walletId, amount, 'trade_in', {
    ...reference,
    actorId: sell.userId,
    description: `Sold ${shares} ${listing.ticker} at ${at}`,
    counterpartyWalletId: buy.walletId,
  });
  await addShares(tx, listing.id, sell.userId, -shares);
  await addShares(tx, listing.id, buy.userId, shares);
  for (const order of [buy, sell]) {
    const filled = order.filled + shares;
    await tx
      .update(stockOrders)
      .set({ filled, status: filled === order.shares ? 'filled' : 'open', updatedAt: new Date() })
      .where(eq(stockOrders.id, order.id));
    order.filled = filled;
    if (filled === order.shares && order.side === 'buy')
      await tx
        .delete(fundLocks)
        .where(and(eq(fundLocks.reason, ORDER_HOLD), eq(fundLocks.referenceId, order.id)));
  }
  // Price discovery: the listing trades at its last price.
  await tx.insert(stockPriceHistory).values({ listingId: listing.id, price });
  await tx
    .update(stockListings)
    .set({ sharePrice: price, updatedAt: new Date() })
    .where(eq(stockListings.id, listing.id));
  return trade!;
}

/**
 * Place a limit order and match it at once against the book (price, then time priority). The
 * listing row must be locked by the caller, so matching on one listing is serialised.
 */
export async function placeOrder(
  tx: Db,
  listing: ListingRow,
  input: { userId: string; side: 'buy' | 'sell'; shares: bigint; price: bigint },
) {
  if (input.price <= 0n) throw badRequest('The price must be positive');
  const wallet = await getOrCreateWallet(tx, { type: 'user', id: input.userId }, listing.currency);
  if (input.side === 'buy') {
    const locked = await lockWallet(tx, wallet.id);
    const frozen = (await frozenAmounts(tx, [wallet.id])).get(wallet.id) ?? 0n;
    const cost = input.shares * input.price;
    if (locked.balance - frozen < cost)
      throw insufficientFunds(
        text`This order needs ${formatAmount(cost, listing.currency)} ${listing.currency}; ${formatAmount(locked.balance - frozen, listing.currency)} is available`,
      );
  } else {
    const { sellable } = await position(tx, listing.id, input.userId);
    if (sellable < input.shares)
      throw conflict(
        sellable === 0n
          ? `You have no ${listing.ticker} shares to sell (shares from investments unlock after the lock period)`
          : `You can sell up to ${sellable} ${listing.ticker} shares`,
      );
  }
  const [order] = await tx
    .insert(stockOrders)
    .values({ listingId: listing.id, walletId: wallet.id, ...input })
    .returning();
  if (input.side === 'buy')
    await tx.insert(fundLocks).values({
      walletId: wallet.id,
      amount: input.shares * input.price,
      reason: ORDER_HOLD,
      referenceId: order!.id,
      unlocksAt: HOLD_UNTIL,
    });

  const trades: TradeRow[] = [];
  const touchedWallets = new Set<string>([wallet.id]);
  const buying = input.side === 'buy';
  while (order!.filled < order!.shares) {
    const [counter] = await tx
      .select()
      .from(stockOrders)
      .where(
        and(
          eq(stockOrders.listingId, listing.id),
          eq(stockOrders.status, 'open'),
          eq(stockOrders.side, buying ? 'sell' : 'buy'),
          ne(stockOrders.userId, input.userId),
          buying ? lte(stockOrders.price, input.price) : gte(stockOrders.price, input.price),
        ),
      )
      .orderBy(buying ? asc(stockOrders.price) : desc(stockOrders.price), asc(stockOrders.createdAt))
      .limit(1)
      .for('update');
    if (!counter) break;
    const shares = [order!.shares - order!.filled, counter.shares - counter.filled].reduce((a, b) =>
      a < b ? a : b,
    );
    const trade = await executeTrade(
      tx,
      listing,
      buying ? order! : counter,
      buying ? counter : order!,
      shares,
      counter.price,
      input.side,
    );
    trades.push(trade);
    touchedWallets.add(counter.walletId);
  }
  const [fresh] = await tx.select().from(stockOrders).where(eq(stockOrders.id, order!.id));
  return { order: fresh!, trades, touchedWallets: [...touchedWallets] };
}

/** Cancel an open order and release what it held. */
export async function cancelOrder(tx: Db, order: OrderRow) {
  if (order.status !== 'open') throw conflict(text`This order is already ${order.status}`);
  await tx
    .update(stockOrders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(stockOrders.id, order.id));
  await tx
    .delete(fundLocks)
    .where(and(eq(fundLocks.reason, ORDER_HOLD), eq(fundLocks.referenceId, order.id)));
}
