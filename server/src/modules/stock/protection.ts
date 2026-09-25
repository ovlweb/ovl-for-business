import {
  formatAmount,
  myStockLimitsSchema,
  parseAmount,
  RISK_DISCLOSURE,
  riskDisclosureSchema,
  stockLimitsSchema,
  updateStockLimitsSchema,
} from '@ovl/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { platformSettings, riskAcknowledgements, shareholdings, stockOrders, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, conflict, HttpError } from '../../lib/errors';
import { convert, loadRateTable, type RateTable } from '../../lib/fx';
import { iso } from '../../lib/mappers';
import { currentUser } from '../../plugins/auth';
import type { ListingRow } from './service';

interface LimitSettings {
  maxHoldingPercent: number;
  /** Decimal strings in the exchange base currency, or null for no limit. */
  monthlyLimit: string | null;
  unverifiedMonthlyLimit: string | null;
}

const DEFAULT_LIMITS: LimitSettings = {
  maxHoldingPercent: 25,
  monthlyLimit: null,
  unverifiedMonthlyLimit: null,
};
const WINDOW_DAYS = 30;

export async function loadLimits(db: Db): Promise<LimitSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'stock'));
  return { ...DEFAULT_LIMITS, ...(row?.value as Partial<LimitSettings> | undefined) };
}

/** Amounts in other currencies count at the exchange rate (face value when there is none). */
function toBase(amount: bigint, currency: string, table: RateTable): bigint {
  if (currency === table.base) return amount;
  return (
    convert(amount, currency, table.base, table) ?? parseAmount(formatAmount(amount, currency), table.base)
  );
}

export async function assertRiskAccepted(db: Db, config: Config, userId: string) {
  if (!config.STOCK_REQUIRE_RISK_ACK) return;
  const [row] = await db
    .select()
    .from(riskAcknowledgements)
    .where(
      and(eq(riskAcknowledgements.userId, userId), eq(riskAcknowledgements.version, RISK_DISCLOSURE.version)),
    );
  if (!row)
    throw new HttpError(
      403,
      'risk_disclosure_required',
      'Read and accept the risk disclosure before investing (GET /stock/risk, POST /stock/risk/accept)',
    );
}

/** What someone invested and bought (or offered to buy) in the last 30 days, in the base currency. */
async function usedThisMonth(db: Db, userId: string, table: RateTable) {
  const rows = await db.execute<{ currency: string; amount: string }>(sql`
    select currency, sum(amount)::text as amount from (
      select l.currency, i.amount from investments i join stock_listings l on l.id = i.listing_id
        where i.investor_id = ${userId} and i.created_at > now() - interval '${sql.raw(String(WINDOW_DAYS))} days'
      union all
      select l.currency, t.price * t.shares from stock_trades t join stock_listings l on l.id = t.listing_id
        where t.buyer_id = ${userId} and t.created_at > now() - interval '${sql.raw(String(WINDOW_DAYS))} days'
      union all
      select l.currency, o.price * (o.shares - o.filled) from stock_orders o join stock_listings l on l.id = o.listing_id
        where o.user_id = ${userId} and o.side = 'buy' and o.status = 'open'
    ) t group by currency`);
  return [...rows].reduce((sum, r) => sum + toBase(BigInt(r.amount), r.currency, table), 0n);
}

async function limitFor(db: Db, userId: string, limits: LimitSettings) {
  const [user] = await db
    .select({ verifiedAt: users.identityVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  const verified = !!user?.verifiedAt;
  const decimal = verified ? limits.monthlyLimit : (limits.unverifiedMonthlyLimit ?? limits.monthlyLimit);
  return { verified, decimal };
}

/**
 * Check a purchase (an investment or a buy order) against the per-investor limits: the most of
 * a company one person may hold, and how much they may put in per 30 days. Serialised per person.
 */
export async function assertWithinLimits(
  tx: Db,
  input: { userId: string; listing: ListingRow; shares: bigint; cost: bigint },
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invest:${input.userId}`}, 0))`);
  const limits = await loadLimits(tx);
  const cap = (input.listing.totalShares * BigInt(Math.round(limits.maxHoldingPercent * 100))) / 10_000n;
  const [[held], [pending]] = await Promise.all([
    tx
      .select({ shares: shareholdings.shares })
      .from(shareholdings)
      .where(and(eq(shareholdings.listingId, input.listing.id), eq(shareholdings.userId, input.userId))),
    tx
      .select({ n: sql<string>`coalesce(sum(${stockOrders.shares} - ${stockOrders.filled}), 0)` })
      .from(stockOrders)
      .where(
        and(
          eq(stockOrders.listingId, input.listing.id),
          eq(stockOrders.userId, input.userId),
          eq(stockOrders.side, 'buy'),
          eq(stockOrders.status, 'open'),
        ),
      ),
  ]);
  const after = (held?.shares ?? 0n) + BigInt(pending?.n ?? 0) + input.shares;
  if (after > cap)
    throw conflict(
      `Nobody may hold more than ${limits.maxHoldingPercent}% of ${input.listing.ticker} (${cap} shares); ` +
        `with open orders you would have ${after}`,
    );
  const { decimal } = await limitFor(tx, input.userId, limits);
  if (!decimal) return;
  const table = await loadRateTable(tx);
  const limit = parseAmount(decimal, table.base);
  const used = await usedThisMonth(tx, input.userId, table);
  const adding = toBase(input.cost, input.listing.currency, table);
  if (used + adding > limit)
    throw conflict(
      `This goes over your limit of ${decimal} ${table.base} per ${WINDOW_DAYS} days: ` +
        `${formatAmount(limit - used > 0n ? limit - used : 0n, table.base)} ${table.base} left` +
        ' (a verified identity may raise it)',
    );
}

export async function protectionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['stock exchange'];

  const disclosure = async (userId?: string) => {
    const [row] = userId
      ? await app.db
          .select()
          .from(riskAcknowledgements)
          .where(
            and(
              eq(riskAcknowledgements.userId, userId),
              eq(riskAcknowledgements.version, RISK_DISCLOSURE.version),
            ),
          )
      : [];
    return {
      ...RISK_DISCLOSURE,
      points: [...RISK_DISCLOSURE.points],
      acceptedAt: row ? iso(row.acceptedAt) : null,
    };
  };
  const settingsDto = async () => ({
    ...(await loadLimits(app.db)),
    base: (await loadRateTable(app.db)).base,
  });

  app.get(
    '/stock/risk',
    {
      preHandler: app.optionalAuth,
      schema: {
        tags,
        security: [{}, { bearerAuth: [] }],
        description: 'The risk disclosure investors accept before their first investment or trade.',
        response: { 200: riskDisclosureSchema },
      },
    },
    async (req) => disclosure(req.user?.id),
  );

  app.post(
    '/stock/risk/accept',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        body: z.object({ version: z.string().max(16) }),
        response: { 200: riskDisclosureSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      if (req.body.version !== RISK_DISCLOSURE.version)
        throw badRequest('The disclosure changed; read the current version first');
      await app.db
        .insert(riskAcknowledgements)
        .values({ userId: me.id, version: RISK_DISCLOSURE.version })
        .onConflictDoNothing();
      await audit(app.db, {
        actorId: me.id,
        action: 'stock.risk_accepted',
        targetType: 'user',
        targetId: me.id,
        data: { version: RISK_DISCLOSURE.version },
        ip: req.ip,
      });
      return disclosure(me.id);
    },
  );

  app.get(
    '/stock/limits',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'The investor limits that apply to you and what you used in the last 30 days.',
        response: { 200: myStockLimitsSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const limits = await loadLimits(app.db);
      const table = await loadRateTable(app.db);
      const { verified, decimal } = await limitFor(app.db, me.id, limits);
      const used = await usedThisMonth(app.db, me.id, table);
      const limit = decimal ? parseAmount(decimal, table.base) : null;
      return {
        maxHoldingPercent: limits.maxHoldingPercent,
        monthlyLimit: limit === null ? null : formatAmount(limit, table.base),
        usedThisMonth: formatAmount(used, table.base),
        remaining: limit === null ? null : formatAmount(limit > used ? limit - used : 0n, table.base),
        base: table.base,
        identityVerified: verified,
      };
    },
  );

  app.get(
    '/stock/limit-settings',
    {
      schema: {
        tags,
        security: [],
        description: 'The per-investor limits of the platform.',
        response: { 200: stockLimitsSchema },
      },
    },
    async () => settingsDto(),
  );

  app.put(
    '/admin/stock/limits',
    {
      preHandler: app.requirePermission('stock.manage'),
      schema: {
        tags: ['admin'],
        description: 'Set the per-investor limits ("" turns a monthly limit off).',
        body: updateStockLimitsSchema,
        response: { 200: stockLimitsSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const current = await loadLimits(app.db);
      const { base } = await loadRateTable(app.db);
      const amount = (value: string | undefined, was: string | null) =>
        value === undefined ? was : value ? formatAmount(parseAmount(value, base), base) : null;
      const next: LimitSettings = {
        maxHoldingPercent: req.body.maxHoldingPercent ?? current.maxHoldingPercent,
        monthlyLimit: amount(req.body.monthlyLimit, current.monthlyLimit),
        unverifiedMonthlyLimit: amount(req.body.unverifiedMonthlyLimit, current.unverifiedMonthlyLimit),
      };
      const value = next as unknown as Record<string, unknown>;
      await app.db
        .insert(platformSettings)
        .values({ key: 'stock', value, updatedBy: me.id })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value, updatedBy: me.id, updatedAt: new Date() },
        });
      await audit(app.db, {
        actorId: me.id,
        action: 'stock.limits',
        targetType: 'settings',
        targetId: 'stock',
        data: value,
        ip: req.ip,
      });
      return settingsDto();
    },
  );
}
