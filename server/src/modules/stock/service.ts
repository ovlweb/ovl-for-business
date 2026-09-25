import { formatAmount, percentOf, type StockListing } from '@ovl/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { fundLocks, investments, organizations, stockListings, stockPriceHistory } from '../../db/schema';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { iso } from '../../lib/mappers';
import { emitEvent } from '../../lib/webhooks';
import { credit, debit, getOrCreateWallet, lockWallet } from '../wallets/service';
import { addShares } from './market';

export type ListingRow = typeof stockListings.$inferSelect;

export async function listingDtos(db: Db, rows: ListingRow[]): Promise<StockListing[]> {
  if (!rows.length) return [];
  const ids = rows.map((l) => l.id);
  const [orgs, stats] = await Promise.all([
    db
      .select()
      .from(organizations)
      .where(
        inArray(
          organizations.id,
          rows.map((l) => l.organizationId),
        ),
      ),
    db
      .select({
        listingId: investments.listingId,
        raised: sql<string>`coalesce(sum(${investments.amount}), 0)`,
        investors: sql<number>`count(distinct ${investments.investorId})::int`,
      })
      .from(investments)
      .where(inArray(investments.listingId, ids))
      .groupBy(investments.listingId),
  ]);
  const orgBy = new Map(orgs.map((o) => [o.id, o]));
  const statsBy = new Map(stats.map((s) => [s.listingId, s]));
  return rows.map((l) => {
    const org = orgBy.get(l.organizationId)!;
    const s = statsBy.get(l.id);
    return {
      id: l.id,
      ticker: l.ticker,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        registryNumber: org.registryNumber,
        verified: org.verifiedAt !== null && org.status === 'active',
      },
      currency: l.currency,
      sharePrice: formatAmount(l.sharePrice, l.currency),
      totalShares: l.totalShares.toString(),
      sharesSold: l.sharesSold.toString(),
      sharesAvailable: (l.totalShares - l.sharesSold).toString(),
      marketCap: formatAmount(l.sharePrice * l.totalShares, l.currency),
      raised: formatAmount(BigInt(s?.raised ?? 0), l.currency),
      investorsCount: s?.investors ?? 0,
      freezePercent: l.freezeBps / 100,
      lockDays: l.lockDays,
      status: l.status,
      listedAt: iso(l.listedAt),
    };
  });
}

export async function createListing(
  db: Db,
  input: {
    organizationId: string;
    ticker: string;
    currency: string;
    sharePrice: bigint;
    totalShares: bigint;
    freezePercent: number;
    lockDays: number;
  },
): Promise<ListingRow> {
  const [taken] = await db
    .select({ id: stockListings.id })
    .from(stockListings)
    .where(eq(stockListings.ticker, input.ticker));
  if (taken) throw conflict(`Ticker ${input.ticker} is already used on the exchange`);
  if (input.sharePrice <= 0n) throw badRequest('Share price must be positive');
  const [listing] = await db
    .insert(stockListings)
    .values({
      organizationId: input.organizationId,
      ticker: input.ticker,
      currency: input.currency,
      sharePrice: input.sharePrice,
      totalShares: input.totalShares,
      freezeBps: Math.round(input.freezePercent * 100),
      lockDays: input.lockDays,
    })
    .returning();
  await db.insert(stockPriceHistory).values({ listingId: listing!.id, price: input.sharePrice });
  await emitEvent(
    db,
    'listing.created',
    (await listingDtos(db, [listing!]))[0]! as unknown as Record<string, unknown>,
  );
  return listing!;
}

/**
 * Buy newly issued shares. The money goes to the company's business balance; `freezeBps`
 * of it is frozen there (fund lock) and becomes available after `lockDays`.
 */
export async function invest(db: Db, input: { ticker: string; investorId: string; amount: bigint }) {
  const [listing] = await db
    .select()
    .from(stockListings)
    .where(eq(stockListings.ticker, input.ticker.toUpperCase()))
    .for('update');
  if (!listing) throw notFound('Listing');
  if (listing.status !== 'active') throw conflict(`Trading of ${listing.ticker} is ${listing.status}`);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, listing.organizationId));
  if (!org || org.status !== 'active') throw conflict('This company is suspended');

  const shares = input.amount / listing.sharePrice;
  if (shares < 1n) {
    throw badRequest(
      `Minimum investment is one share: ${formatAmount(listing.sharePrice, listing.currency)} ${listing.currency}`,
    );
  }
  const available = listing.totalShares - listing.sharesSold;
  if (shares > available) throw conflict(`Only ${available} shares of ${listing.ticker} are left`);
  const cost = shares * listing.sharePrice;
  const frozen = percentOf(cost, listing.freezeBps);
  const unlocksAt = new Date(Date.now() + listing.lockDays * 86_400_000);

  const investorWallet = await getOrCreateWallet(
    db,
    { type: 'user', id: input.investorId },
    listing.currency,
  );
  const companyWallet = await getOrCreateWallet(db, { type: 'organization', id: org.id }, listing.currency);
  // Lock in a stable order (same as transfers) before moving money.
  for (const id of [investorWallet.id, companyWallet.id].sort()) await lockWallet(db, id);

  const [investment] = await db
    .insert(investments)
    .values({
      listingId: listing.id,
      investorId: input.investorId,
      fromWalletId: investorWallet.id,
      amount: cost,
      shares,
      frozenAmount: frozen,
      unlocksAt,
    })
    .returning();
  const ref = { referenceType: 'investment', referenceId: investment!.id, actorId: input.investorId };
  await debit(db, investorWallet.id, cost, 'investment_out', {
    ...ref,
    description: `Bought ${shares} ${listing.ticker} shares`,
    counterpartyWalletId: companyWallet.id,
  });
  await credit(db, companyWallet.id, cost, 'investment_in', {
    ...ref,
    description: `Investment: ${shares} ${listing.ticker} shares (${listing.freezeBps / 100}% frozen for ${listing.lockDays} days)`,
    counterpartyWalletId: investorWallet.id,
  });
  if (frozen > 0n) {
    await db.insert(fundLocks).values({
      walletId: companyWallet.id,
      amount: frozen,
      reason: 'investment',
      referenceId: investment!.id,
      unlocksAt,
    });
  }
  await db
    .update(stockListings)
    .set({
      sharesSold: sql`${stockListings.sharesSold} + ${shares.toString()}::bigint`,
      updatedAt: new Date(),
    })
    .where(eq(stockListings.id, listing.id));
  await addShares(db, listing.id, input.investorId, shares);

  return { investment: investment!, listing, org, investorWallet, companyWallet };
}
