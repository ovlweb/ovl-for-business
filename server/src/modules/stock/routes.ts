import {
  formatAmount,
  holdingSchema,
  orderBookSchema,
  placeOrderResultSchema,
  placeOrderSchema,
  stockOrderSchema,
  stockTradeSchema,
  investInputSchema,
  investmentSchema,
  parseAmount,
  stockListingDetailSchema,
  stockListingSchema,
} from '@ovl/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  investments,
  organizations,
  shareholdings,
  stockListings,
  stockOrders,
  stockPriceHistory,
  stockTrades,
  wallets,
} from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { iso } from '../../lib/mappers';
import { apiKeyGuard, publicRouteConfig } from '../../lib/public-api';
import { currentUser } from '../../plugins/auth';
import { walletAudience } from '../wallets/routes';
import { cancelOrder, orderDto, placeOrder, position, tradeDto } from './market';
import { assertRiskAccepted, assertWithinLimits } from './protection';
import { invest, listingDtos } from './service';
import { text } from '../../lib/i18n';

export async function stockRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['stock exchange (public)'];
  const guard = apiKeyGuard(app, 'stock:read');
  const security: Record<string, string[]>[] = [{}, { apiKey: [] }, { bearerAuth: [] }];

  app.get(
    '/stock/listings',
    {
      config: publicRouteConfig(app),
      preHandler: guard,
      schema: {
        tags,
        security,
        description: 'Companies listed on the exchange.',
        querystring: z.object({ status: z.enum(['active', 'halted', 'delisted']).optional() }),
        response: { 200: z.array(stockListingSchema) },
      },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(stockListings)
        .where(req.query.status ? eq(stockListings.status, req.query.status) : undefined)
        .orderBy(stockListings.ticker);
      return listingDtos(app.db, rows);
    },
  );

  app.get(
    '/stock/listings/:ticker',
    {
      config: publicRouteConfig(app),
      preHandler: guard,
      schema: {
        tags,
        security,
        params: z.object({ ticker: z.string().min(1).max(8) }),
        response: { 200: stockListingDetailSchema },
      },
    },
    async (req) => {
      const [listing] = await app.db
        .select()
        .from(stockListings)
        .where(eq(stockListings.ticker, req.params.ticker.toUpperCase()));
      if (!listing) throw notFound('Listing');
      const [[dto], history, [org]] = await Promise.all([
        listingDtos(app.db, [listing]),
        app.db
          .select()
          .from(stockPriceHistory)
          .where(eq(stockPriceHistory.listingId, listing.id))
          .orderBy(desc(stockPriceHistory.createdAt))
          .limit(365),
        app.db.select().from(organizations).where(eq(organizations.id, listing.organizationId)),
      ]);
      return {
        ...dto!,
        description: org?.description ?? '',
        priceHistory: history
          .reverse()
          .map((p) => ({ price: formatAmount(p.price, listing.currency), at: iso(p.createdAt) })),
      };
    },
  );

  app.post(
    '/stock/listings/:ticker/invest',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['stock exchange'],
        description:
          'Invest from your personal wallet in the listing currency. The amount is converted to whole shares; ' +
          'part of it (freezePercent) stays frozen on the company balance for lockDays.',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        body: investInputSchema,
        response: { 201: investmentSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const [listing] = await app.db
        .select({ currency: stockListings.currency })
        .from(stockListings)
        .where(eq(stockListings.ticker, req.params.ticker.toUpperCase()));
      if (!listing) throw notFound('Listing');
      const amount = parseAmount(req.body.amount, listing.currency);
      await assertRiskAccepted(app.db, app.config, me.id);
      const result = await app.db.transaction((tx) =>
        invest(tx, { ticker: req.params.ticker, investorId: me.id, amount }),
      );
      for (const w of [result.investorWallet, result.companyWallet]) {
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      }
      const i = result.investment;
      return reply.status(201).send({
        id: i.id,
        ticker: result.listing.ticker,
        organizationName: result.org.name,
        shares: i.shares.toString(),
        amount: formatAmount(i.amount, result.listing.currency),
        currency: result.listing.currency,
        frozenAmount: formatAmount(i.frozenAmount, result.listing.currency),
        unlocksAt: iso(i.unlocksAt),
        createdAt: iso(i.createdAt),
      });
    },
  );

  app.get(
    '/stock/portfolio',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['stock exchange'],
        description: 'Your holdings and investment history.',
        response: {
          200: z.object({ holdings: z.array(holdingSchema), investments: z.array(investmentSchema) }),
        },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [held, history, flows] = await Promise.all([
        app.db
          .select({
            listingId: stockListings.id,
            ticker: stockListings.ticker,
            currency: stockListings.currency,
            sharePrice: stockListings.sharePrice,
            organizationName: organizations.name,
            organizationSlug: organizations.slug,
            shares: shareholdings.shares,
          })
          .from(shareholdings)
          .innerJoin(stockListings, eq(stockListings.id, shareholdings.listingId))
          .innerJoin(organizations, eq(organizations.id, stockListings.organizationId))
          .where(and(eq(shareholdings.userId, me.id), sql`${shareholdings.shares} > 0`))
          .orderBy(stockListings.ticker),
        app.db
          .select({
            i: investments,
            ticker: stockListings.ticker,
            currency: stockListings.currency,
            orgName: organizations.name,
          })
          .from(investments)
          .innerJoin(stockListings, eq(stockListings.id, investments.listingId))
          .innerJoin(organizations, eq(organizations.id, stockListings.organizationId))
          .where(and(eq(investments.investorId, me.id)))
          .orderBy(desc(investments.createdAt))
          .limit(200),
        // Money put in: investments, plus purchases, minus sales on the market.
        app.db.execute<{ listing_id: string; net: string }>(sql`
          select listing_id, sum(net)::text as net from (
            select listing_id, amount as net from investments where investor_id = ${me.id}
            union all select listing_id, price * shares from stock_trades where buyer_id = ${me.id}
            union all select listing_id, -(price * shares) from stock_trades where seller_id = ${me.id}
          ) t group by listing_id`),
      ]);
      const netBy = new Map([...flows].map((f) => [f.listing_id, BigInt(f.net)]));
      const holdings = await Promise.all(
        held.map(async (h) => ({ ...h, position: await position(app.db, h.listingId, me.id) })),
      );
      return {
        holdings: holdings.map((h) => ({
          ticker: h.ticker,
          organizationName: h.organizationName,
          organizationSlug: h.organizationSlug,
          currency: h.currency,
          shares: h.shares.toString(),
          sellable: h.position.sellable.toString(),
          locked: h.position.locked.toString(),
          onSale: h.position.onSale.toString(),
          invested: formatAmount(netBy.get(h.listingId) ?? 0n, h.currency),
          currentValue: formatAmount(h.shares * h.sharePrice, h.currency),
        })),
        investments: history.map(({ i, ticker, currency, orgName }) => ({
          id: i.id,
          ticker,
          organizationName: orgName,
          shares: i.shares.toString(),
          amount: formatAmount(i.amount, currency),
          currency,
          frozenAmount: formatAmount(i.frozenAmount, currency),
          unlocksAt: iso(i.unlocksAt),
          createdAt: iso(i.createdAt),
        })),
      };
    },
  );

  // ----- Secondary market ------------------------------------------------------------

  const loadListing = async (ticker: string) => {
    const [listing] = await app.db
      .select()
      .from(stockListings)
      .where(eq(stockListings.ticker, ticker.toUpperCase()));
    if (!listing) throw notFound('Listing');
    return listing;
  };

  app.get(
    '/stock/listings/:ticker/book',
    {
      config: publicRouteConfig(app),
      preHandler: guard,
      schema: {
        tags,
        security,
        description: 'The order book (open buy and sell orders by price) and the latest trades.',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        response: { 200: orderBookSchema },
      },
    },
    async (req) => {
      const listing = await loadListing(req.params.ticker);
      const level = (side: 'buy' | 'sell') =>
        app.db
          .select({
            price: stockOrders.price,
            shares: sql<string>`sum(${stockOrders.shares} - ${stockOrders.filled})`,
            orders: sql<number>`count(*)::int`,
          })
          .from(stockOrders)
          .where(
            and(
              eq(stockOrders.listingId, listing.id),
              eq(stockOrders.side, side),
              eq(stockOrders.status, 'open'),
            ),
          )
          .groupBy(stockOrders.price)
          .orderBy(side === 'buy' ? desc(stockOrders.price) : asc(stockOrders.price))
          .limit(20);
      const [bids, asks, trades] = await Promise.all([
        level('buy'),
        level('sell'),
        app.db
          .select()
          .from(stockTrades)
          .where(eq(stockTrades.listingId, listing.id))
          .orderBy(desc(stockTrades.createdAt))
          .limit(30),
      ]);
      const fmt = (l: { price: bigint; shares: string; orders: number }) => ({
        price: formatAmount(l.price, listing.currency),
        shares: l.shares,
        orders: l.orders,
      });
      return {
        ticker: listing.ticker,
        currency: listing.currency,
        bids: bids.map(fmt),
        asks: asks.map(fmt),
        lastPrice: formatAmount(listing.sharePrice, listing.currency),
        trades: trades.map((t) => tradeDto(t, listing.currency)),
      };
    },
  );

  app.post(
    '/stock/listings/:ticker/orders',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['stock exchange'],
        description:
          'Place a limit order on the secondary market. It trades at once with matching orders (best price, ' +
          "then oldest first, at the resting order's price) and the rest stays in the book. A buy order holds " +
          'its money; only shares past their lock period can be sold.',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        body: placeOrderSchema,
        response: { 201: placeOrderResultSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { side, shares, price: decimal } = req.body;
      if (side === 'buy') await assertRiskAccepted(app.db, app.config, me.id);
      const result = await app.db.transaction(async (tx) => {
        const [listing] = await tx
          .select()
          .from(stockListings)
          .where(eq(stockListings.ticker, req.params.ticker.toUpperCase()))
          .for('update');
        if (!listing) throw notFound('Listing');
        if (listing.status !== 'active')
          throw conflict(text`Trading of ${listing.ticker} is ${listing.status}`);
        const price = parseAmount(decimal, listing.currency);
        if (side === 'buy')
          await assertWithinLimits(tx, {
            userId: me.id,
            listing,
            shares: BigInt(shares),
            cost: BigInt(shares) * price,
          });
        const placed = await placeOrder(tx, listing, { userId: me.id, side, shares: BigInt(shares), price });
        return { ...placed, listing };
      });
      const touched = await app.db.select().from(wallets).where(inArray(wallets.id, result.touchedWallets));
      for (const w of touched)
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      app.hub.broadcast({ type: 'stock.updated', ticker: result.listing.ticker });
      return reply.status(201).send({
        order: orderDto(result.order, result.listing),
        trades: result.trades.map((t) => tradeDto(t, result.listing.currency)),
      });
    },
  );

  app.get(
    '/stock/orders',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['stock exchange'],
        description: 'Your orders, newest first.',
        querystring: z.object({ status: z.enum(['open', 'filled', 'cancelled']).optional() }),
        response: { 200: z.array(stockOrderSchema) },
      },
    },
    async (req) => {
      const rows = await app.db
        .select({ o: stockOrders, ticker: stockListings.ticker, currency: stockListings.currency })
        .from(stockOrders)
        .innerJoin(stockListings, eq(stockListings.id, stockOrders.listingId))
        .where(
          and(
            eq(stockOrders.userId, currentUser(req).id),
            req.query.status ? eq(stockOrders.status, req.query.status) : undefined,
          ),
        )
        .orderBy(desc(stockOrders.createdAt))
        .limit(200);
      return rows.map((r) => orderDto(r.o, r));
    },
  );

  app.delete(
    '/stock/orders/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['stock exchange'],
        description: 'Cancel what is left of an open order (a buy order releases its money).',
        params: z.object({ id: z.uuid() }),
        response: { 200: stockOrderSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { order, listing } = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ o: stockOrders, l: stockListings })
          .from(stockOrders)
          .innerJoin(stockListings, eq(stockListings.id, stockOrders.listingId))
          .where(and(eq(stockOrders.id, req.params.id), eq(stockOrders.userId, me.id)))
          .for('update', { of: stockOrders });
        if (!row) throw notFound('Order');
        await cancelOrder(tx, row.o);
        const [fresh] = await tx.select().from(stockOrders).where(eq(stockOrders.id, row.o.id));
        return { order: fresh!, listing: row.l };
      });
      const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, order.walletId));
      if (wallet) app.hub.sendToUsers([me.id], { type: 'wallet.updated', walletId: wallet.id });
      app.hub.broadcast({ type: 'stock.updated', ticker: listing.ticker });
      return orderDto(order, listing);
    },
  );
}
