import {
  formatAmount,
  holdingSchema,
  investInputSchema,
  investmentSchema,
  parseAmount,
  stockListingDetailSchema,
  stockListingSchema,
} from '@ovl/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { investments, organizations, stockListings, stockPriceHistory } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { iso } from '../../lib/mappers';
import { apiKeyGuard, publicRouteConfig } from '../../lib/public-api';
import { currentUser } from '../../plugins/auth';
import { walletAudience } from '../wallets/routes';
import { invest, listingDtos } from './service';

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
      const [holdings, history] = await Promise.all([
        app.db
          .select({
            ticker: stockListings.ticker,
            currency: stockListings.currency,
            sharePrice: stockListings.sharePrice,
            organizationName: organizations.name,
            organizationSlug: organizations.slug,
            shares: sql<string>`sum(${investments.shares})`,
            invested: sql<string>`sum(${investments.amount})`,
          })
          .from(investments)
          .innerJoin(stockListings, eq(stockListings.id, investments.listingId))
          .innerJoin(organizations, eq(organizations.id, stockListings.organizationId))
          .where(eq(investments.investorId, me.id))
          .groupBy(stockListings.id, organizations.id),
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
      ]);
      return {
        holdings: holdings.map((h) => ({
          ticker: h.ticker,
          organizationName: h.organizationName,
          organizationSlug: h.organizationSlug,
          currency: h.currency,
          shares: h.shares,
          invested: formatAmount(BigInt(h.invested), h.currency),
          currentValue: formatAmount(BigInt(h.shares) * h.sharePrice, h.currency),
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
}
