import {
  adminStatsSchema,
  adminUpdateUserSchema,
  adminUserSchema,
  apiKeySchema,
  auditLogSchema,
  canAssignRole,
  cashOperationInputSchema,
  cashApprovalSchema,
  cashOperationSchema,
  formatAmount,
  organizationSchema,
  pageOf,
  paginationQuery,
  parseAmount,
  REGISTRY_STATUSES,
  registryEntrySchema,
  roleSchema,
  stockListingSchema,
  updateListingSchema,
  walletOwnerTypeSchema,
  walletSchema,
  type CashOperation,
} from '@ovl/shared';
import { and, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  apiKeys,
  applications,
  auditLogs,
  cashApprovals,
  cashOperations,
  cashRequests,
  chats,
  messages,
  organizations,
  refreshTokens,
  registryEntries,
  sessions,
  stockListings,
  stockPriceHistory,
  users,
  wallets,
} from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { iso, isoOrNull, toUserSummary } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { toApiKeyDto } from './api-keys';
import { organizationDtos } from './organizations';
import { getRegistryEntry } from './registry';
import { recordCashOperation } from './cash';
import { approvalDtos, createApproval, needsFourEyes, pendingApprovalCount } from './cash-approvals';
import { pendingIdentityChecks } from './identity';
import { changeRole } from './roles';
import { revokeSessions } from './sessions';
import { listingDtos } from './stock/service';
import { walletAudience } from './wallets/routes';
import { getOrCreateWallet, listOwnerWallets } from './wallets/service';

const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

const ACTIVITY_DAYS = 14;

/** Daily counts for the dashboard chart, one row per UTC day, oldest first, gaps filled with 0. */
async function activity(db: Db) {
  const since = sql`date_trunc('day', now() at time zone 'utc') - interval '${sql.raw(String(ACTIVITY_DAYS - 1))} days'`;
  const perDay = (table: typeof users | typeof messages | typeof applications) =>
    db
      .select({ day: sql<string>`to_char(${table.createdAt} at time zone 'utc', 'YYYY-MM-DD')`, n: count() })
      .from(table)
      .where(sql`${table.createdAt} at time zone 'utc' >= ${since}`)
      .groupBy(sql`1`);
  const [signups, sent, filed] = await Promise.all([perDay(users), perDay(messages), perDay(applications)]);
  const lookup = (rows: { day: string; n: number }[]) => new Map(rows.map((r) => [r.day, r.n]));
  const [s, m, a] = [lookup(signups), lookup(sent), lookup(filed)];
  const today = new Date();
  return Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (ACTIVITY_DAYS - 1 - i)),
    );
    const date = d.toISOString().slice(0, 10);
    return { date, signups: s.get(date) ?? 0, messages: m.get(date) ?? 0, applications: a.get(date) ?? 0 };
  });
}

async function cashOperationDtos(db: Db, where?: SQL, limit = 50, offset = 0): Promise<CashOperation[]> {
  const rows = await db
    .select({
      op: cashOperations,
      wallet: wallets,
      userName: users.displayName,
      username: users.username,
      orgName: organizations.name,
    })
    .from(cashOperations)
    .innerJoin(wallets, eq(wallets.id, cashOperations.walletId))
    .leftJoin(users, eq(users.id, wallets.userId))
    .leftJoin(organizations, eq(organizations.id, wallets.organizationId))
    .where(where)
    .orderBy(desc(cashOperations.createdAt))
    .limit(limit)
    .offset(offset);
  const processorIds = [...new Set(rows.map((r) => r.op.processedBy))];
  const processors = processorIds.length
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, processorIds))
    : [];
  const processorBy = new Map(processors.map((p) => [p.id, p]));
  return rows.map(({ op, wallet, userName, username, orgName }) => ({
    id: op.id,
    walletId: op.walletId,
    ownerType: wallet.ownerType,
    ownerId: (wallet.userId ?? wallet.organizationId)!,
    ownerName: wallet.ownerType === 'user' ? `${userName} (@${username})` : (orgName ?? ''),
    type: op.type,
    method: op.method,
    amount: formatAmount(op.amount, op.currency),
    currency: op.currency,
    reference: op.reference,
    note: op.note,
    processedBy: processorBy.get(op.processedBy) ?? {
      id: op.processedBy,
      username: 'unknown',
      displayName: 'Unknown',
    },
    createdAt: iso(op.createdAt),
  }));
}

/** Endpoints used by the separate admin panel. Every mutation is written to the audit log. */
export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['admin'];

  app.get(
    '/admin/stats',
    {
      preHandler: app.requirePermission('admin.panel'),
      schema: { tags, response: { 200: adminStatsSchema } },
    },
    async () => {
      const [
        byRole,
        [orgs],
        [pending],
        [tickets],
        [listings],
        [registry],
        [cash],
        identity,
        approvals,
        balances,
        daily,
      ] = await Promise.all([
        app.db.select({ role: users.role, n: count() }).from(users).groupBy(users.role),
        app.db.select({ n: count() }).from(organizations),
        app.db.select({ n: count() }).from(applications).where(eq(applications.status, 'pending')),
        app.db
          .select({ n: count() })
          .from(chats)
          .where(and(eq(chats.type, 'support'), eq(chats.supportStatus, 'open'))),
        app.db.select({ n: count() }).from(stockListings).where(eq(stockListings.status, 'active')),
        app.db.select({ n: count() }).from(registryEntries),
        app.db.select({ n: count() }).from(cashRequests).where(eq(cashRequests.status, 'pending')),
        pendingIdentityChecks(app.db),
        pendingApprovalCount(app.db),
        app.db
          .select({ currency: wallets.currency, total: sql<string>`sum(${wallets.balance})`, n: count() })
          .from(wallets)
          .groupBy(wallets.currency)
          .orderBy(wallets.currency),
        activity(app.db),
      ]);
      return {
        users: Object.fromEntries(byRole.map((r) => [r.role, r.n])),
        organizations: orgs?.n ?? 0,
        pendingApplications: pending?.n ?? 0,
        openTickets: tickets?.n ?? 0,
        activeListings: listings?.n ?? 0,
        registryEntries: registry?.n ?? 0,
        pendingCashRequests: cash?.n ?? 0,
        pendingIdentityChecks: identity,
        pendingCashApprovals: approvals,
        balances: balances.map((b) => ({
          currency: b.currency,
          total: formatAmount(BigInt(b.total), b.currency),
          wallets: b.n,
        })),
        activity: daily,
      };
    },
  );

  // ----- Users --------------------------------------------------------------

  app.get(
    '/admin/users',
    {
      preHandler: app.requirePermission('users.view'),
      schema: {
        tags,
        querystring: paginationQuery.extend({
          q: z.string().trim().max(100).optional(),
          role: roleSchema.optional(),
          status: z.enum(['active', 'suspended']).optional(),
        }),
        response: { 200: pageOf(adminUserSchema) },
      },
    },
    async (req) => {
      const { q, role, status, limit, offset } = req.query;
      const where = and(
        q
          ? or(ilike(users.username, like(q)), ilike(users.displayName, like(q)), ilike(users.email, like(q)))
          : undefined,
        role ? eq(users.role, role) : undefined,
        status ? eq(users.status, status) : undefined,
      );
      const [rows, [total]] = await Promise.all([
        app.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
        app.db.select({ n: count() }).from(users).where(where),
      ]);
      return {
        items: rows.map((u) => ({
          ...toUserSummary(u),
          email: u.email,
          status: u.status,
          createdAt: iso(u.createdAt),
          lastSeenAt: isoOrNull(u.lastSeenAt),
        })),
        total: total?.n ?? 0,
        limit,
        offset,
      };
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      preHandler: app.requirePermission('users.manage'),
      schema: {
        tags,
        description:
          'Change role and/or suspend. Admins manage user / moderator / manager; the owner manages everyone.',
        params: z.object({ id: z.uuid() }),
        body: adminUpdateUserSchema,
        response: { 200: adminUserSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [target] = await app.db.select().from(users).where(eq(users.id, req.params.id));
      if (!target) throw notFound('User');
      if (target.id === me.id) throw badRequest('You cannot change your own account here');
      const { role, status } = req.body;
      if (role && role !== target.role && !canAssignRole(me.role, target.role, role)) {
        throw forbidden(`You cannot change a ${target.role} into a ${role}`);
      }
      if (status && status !== target.status && !canAssignRole(me.role, target.role, target.role)) {
        throw forbidden(`You cannot suspend a ${target.role}`);
      }
      const updated = await app.db.transaction(async (tx) => {
        if (role && role !== target.role) await changeRole(tx, target.id, role);
        if (status && status !== target.status) {
          await tx.update(users).set({ status }).where(eq(users.id, target.id));
          if (status === 'suspended') {
            await tx
              .update(refreshTokens)
              .set({ revokedAt: new Date() })
              .where(and(eq(refreshTokens.userId, target.id), isNull(refreshTokens.revokedAt)));
          }
        }
        await audit(tx, {
          actorId: me.id,
          action: 'user.update',
          targetType: 'user',
          targetId: target.id,
          data: { from: { role: target.role, status: target.status }, to: req.body },
          ip: req.ip,
        });
        const [row] = await tx.select().from(users).where(eq(users.id, target.id));
        return row!;
      });
      if (status === 'suspended' && target.status !== 'suspended') {
        await revokeSessions(app, eq(sessions.userId, target.id));
      }
      app.hub.updateRole(updated.id, updated.role);
      return {
        ...toUserSummary(updated),
        email: updated.email,
        status: updated.status,
        createdAt: iso(updated.createdAt),
        lastSeenAt: isoOrNull(updated.lastSeenAt),
      };
    },
  );

  // ----- Organizations ------------------------------------------------------

  app.post(
    '/admin/users/:id/sign-out',
    {
      preHandler: app.requirePermission('users.manage'),
      schema: {
        tags,
        description: 'Sign an account out on every device (e.g. a lost phone or a compromised password).',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ signedOut: z.number().int() }) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [target] = await app.db.select().from(users).where(eq(users.id, req.params.id));
      if (!target) throw notFound('User');
      if (target.id !== me.id && !canAssignRole(me.role, target.role, target.role)) {
        throw forbidden(`You cannot sign out a ${target.role}`);
      }
      const ids = await revokeSessions(app, eq(sessions.userId, target.id));
      await audit(app.db, {
        actorId: me.id,
        action: 'user.sign_out',
        targetType: 'user',
        targetId: target.id,
        data: { sessions: ids.length },
        ip: req.ip,
      });
      return { signedOut: ids.length };
    },
  );
  app.get(
    '/admin/organizations',
    {
      preHandler: app.requirePermission('admin.panel'),
      schema: {
        tags,
        querystring: paginationQuery.extend({ q: z.string().trim().max(100).optional() }),
        response: { 200: pageOf(organizationSchema) },
      },
    },
    async (req) => {
      const { q, limit, offset } = req.query;
      const where = q
        ? or(ilike(organizations.name, like(q)), ilike(organizations.slug, like(q)))
        : undefined;
      const [rows, [total]] = await Promise.all([
        app.db
          .select()
          .from(organizations)
          .where(where)
          .orderBy(desc(organizations.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(organizations).where(where),
      ]);
      return { items: await organizationDtos(app.db, rows), total: total?.n ?? 0, limit, offset };
    },
  );

  app.patch(
    '/admin/organizations/:id',
    {
      preHandler: app.requirePermission('organizations.manage'),
      schema: {
        tags,
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(['active', 'suspended']) }),
        response: { 200: organizationSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [org] = await app.db
        .update(organizations)
        .set({ status: req.body.status })
        .where(eq(organizations.id, req.params.id))
        .returning();
      if (!org) throw notFound('Organization');
      await audit(app.db, {
        actorId: me.id,
        action: 'organization.status',
        targetType: 'organization',
        targetId: org.id,
        data: req.body,
        ip: req.ip,
      });
      return (await organizationDtos(app.db, [org]))[0]!;
    },
  );

  // ----- Cash desk: deposits & withdrawals ---------------------------------

  app.get(
    '/admin/owners',
    {
      preHandler: app.requirePermission('wallet.view_all'),
      schema: {
        tags,
        description: 'Find a person or a company to deposit to.',
        querystring: z.object({ q: z.string().trim().min(1).max(100) }),
        response: {
          200: z.array(
            z.object({ type: walletOwnerTypeSchema, id: z.uuid(), name: z.string(), handle: z.string() }),
          ),
        },
      },
    },
    async (req) => {
      const pattern = like(req.query.q);
      const [people, companies] = await Promise.all([
        app.db
          .select()
          .from(users)
          .where(
            or(
              ilike(users.username, pattern),
              ilike(users.displayName, pattern),
              ilike(users.email, pattern),
            ),
          )
          .limit(10),
        app.db
          .select()
          .from(organizations)
          .where(or(ilike(organizations.name, pattern), ilike(organizations.slug, pattern)))
          .limit(10),
      ]);
      return [
        ...people.map((u) => ({ type: 'user' as const, id: u.id, name: u.displayName, handle: u.username })),
        ...companies.map((o) => ({ type: 'organization' as const, id: o.id, name: o.name, handle: o.slug })),
      ];
    },
  );

  app.get(
    '/admin/wallets',
    {
      preHandler: app.requirePermission('wallet.view_all'),
      schema: {
        tags,
        querystring: z.object({ ownerType: walletOwnerTypeSchema, ownerId: z.uuid() }),
        response: { 200: z.array(walletSchema) },
      },
    },
    async (req) => listOwnerWallets(app.db, { type: req.query.ownerType, id: req.query.ownerId }),
  );

  app.get(
    '/admin/cash-operations',
    {
      preHandler: app.requirePermission('wallet.view_all'),
      schema: { tags, querystring: paginationQuery, response: { 200: pageOf(cashOperationSchema) } },
    },
    async (req) => {
      const { limit, offset } = req.query;
      const [items, [total]] = await Promise.all([
        cashOperationDtos(app.db, undefined, limit, offset),
        app.db.select({ n: count() }).from(cashOperations),
      ]);
      return { items, total: total?.n ?? 0, limit, offset };
    },
  );

  app.post(
    '/admin/cash-operations',
    {
      preHandler: app.requirePermission('wallet.cash'),
      schema: {
        tags,
        description:
          'Deposit to or withdraw from a personal or business balance in any currency. ' +
          'Method is either a transfer handled by a manager or physical cash at the desk.',
        body: cashOperationInputSchema,
        response: { 201: cashOperationSchema, 202: cashApprovalSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const input = req.body;
      const amount = parseAmount(input.amount, input.currency);
      const { opId, approvalId, wallet } = await app.db.transaction(async (tx) => {
        const ownerTable = input.ownerType === 'user' ? users : organizations;
        const [owner] = await tx
          .select({ id: ownerTable.id })
          .from(ownerTable)
          .where(eq(ownerTable.id, input.ownerId));
        if (!owner) throw notFound(input.ownerType === 'user' ? 'User' : 'Organization');
        const wallet = await getOrCreateWallet(
          tx,
          { type: input.ownerType, id: input.ownerId },
          input.currency,
        );
        if (needsFourEyes(app.config, amount, input.currency)) {
          const approval = await createApproval(tx, {
            kind: 'operation',
            walletId: wallet.id,
            type: input.type,
            method: input.method,
            amount,
            currency: input.currency,
            reference: input.reference,
            note: input.note,
            requestedBy: me.id,
            ip: req.ip,
          });
          return { opId: null, approvalId: approval.id, wallet };
        }
        const opId = await recordCashOperation(tx, {
          wallet,
          type: input.type,
          method: input.method,
          amount,
          reference: input.reference,
          note: input.note,
          actorId: me.id,
          ip: req.ip,
        });
        return { opId, approvalId: null, wallet };
      });
      if (approvalId) {
        // Large amount: a second finance manager confirms it under Cash desk → Waiting for approval.
        const [pending] = await approvalDtos(app.db, eq(cashApprovals.id, approvalId), 1);
        return reply.status(202).send(pending!);
      }
      app.hub.sendToUsers(await walletAudience(app.db, wallet), {
        type: 'wallet.updated',
        walletId: wallet.id,
      });
      const [dto] = await cashOperationDtos(app.db, eq(cashOperations.id, opId!), 1);
      return reply.status(201).send(dto!);
    },
  );

  // ----- Registry -----------------------------------------------------------

  app.patch(
    '/admin/registry/:id',
    {
      preHandler: app.requirePermission('registry.manage'),
      schema: {
        tags,
        params: z.object({ id: z.uuid() }),
        description: 'Change the status of an entry, or move its expiry date (null: it never expires).',
        body: z
          .object({
            status: z.enum(REGISTRY_STATUSES).optional(),
            expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
            reason: z.string().trim().max(1000).optional(),
          })
          .refine((b) => b.status !== undefined || b.expiresAt !== undefined, 'Nothing to change'),
        response: { 200: registryEntrySchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { status, expiresAt } = req.body;
      const [entry] = await app.db
        .update(registryEntries)
        .set({
          ...(status ? { status } : {}),
          ...(expiresAt !== undefined
            ? { expiresAt: expiresAt ? new Date(expiresAt) : null, reminderStage: 0 }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(registryEntries.id, req.params.id))
        .returning();
      if (!entry) throw notFound('Registry entry');
      await audit(app.db, {
        actorId: me.id,
        action: 'registry.status',
        targetType: 'registry_entry',
        targetId: entry.id,
        data: req.body,
        ip: req.ip,
      });
      return (await getRegistryEntry(app.db, entry.id))!;
    },
  );

  // ----- Stock exchange -----------------------------------------------------

  app.patch(
    '/admin/stock/listings/:id',
    {
      preHandler: app.requirePermission('stock.manage'),
      schema: {
        tags,
        description: 'Adjust price, status, freeze percent and lock period (3–6 months by default config).',
        params: z.object({ id: z.uuid() }),
        body: updateListingSchema,
        response: { 200: stockListingSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [listing] = await app.db.select().from(stockListings).where(eq(stockListings.id, req.params.id));
      if (!listing) throw notFound('Listing');
      const { sharePrice, status, freezePercent, lockDays } = req.body;
      if (
        lockDays !== undefined &&
        (lockDays < app.config.STOCK_LOCK_DAYS_MIN || lockDays > app.config.STOCK_LOCK_DAYS_MAX)
      ) {
        throw badRequest(
          `Lock period must be between ${app.config.STOCK_LOCK_DAYS_MIN} and ${app.config.STOCK_LOCK_DAYS_MAX} days`,
        );
      }
      const price = sharePrice !== undefined ? parseAmount(sharePrice, listing.currency) : undefined;
      if (price !== undefined && price <= 0n) throw badRequest('Share price must be positive');
      const updated = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(stockListings)
          .set({
            sharePrice: price,
            status,
            freezeBps: freezePercent !== undefined ? Math.round(freezePercent * 100) : undefined,
            lockDays,
            updatedAt: new Date(),
          })
          .where(eq(stockListings.id, listing.id))
          .returning();
        if (price !== undefined && price !== listing.sharePrice) {
          await tx.insert(stockPriceHistory).values({ listingId: listing.id, price });
        }
        await audit(tx, {
          actorId: me.id,
          action: 'stock.listing_update',
          targetType: 'stock_listing',
          targetId: listing.id,
          data: req.body,
          ip: req.ip,
        });
        return row!;
      });
      return (await listingDtos(app.db, [updated]))[0]!;
    },
  );

  // ----- Audit log & API keys -----------------------------------------------

  app.get(
    '/admin/audit-logs',
    {
      preHandler: app.requirePermission('audit.view'),
      schema: {
        tags,
        querystring: paginationQuery.extend({ action: z.string().trim().max(64).optional() }),
        response: { 200: pageOf(auditLogSchema) },
      },
    },
    async (req) => {
      const { action, limit, offset } = req.query;
      const where = action ? ilike(auditLogs.action, `${action}%`) : undefined;
      const [rows, [total]] = await Promise.all([
        app.db
          .select({ log: auditLogs, username: users.username })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorId))
          .where(where)
          .orderBy(desc(auditLogs.id))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(auditLogs).where(where),
      ]);
      return {
        items: rows.map(({ log, username }) => ({
          id: log.id,
          actor: log.actorId ? { id: log.actorId, username: username ?? 'deleted' } : null,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          data: log.data,
          ip: log.ip,
          createdAt: iso(log.createdAt),
        })),
        total: total?.n ?? 0,
        limit,
        offset,
      };
    },
  );

  app.get(
    '/admin/api-keys',
    {
      preHandler: app.requirePermission('apikeys.manage'),
      schema: { tags, querystring: paginationQuery, response: { 200: pageOf(apiKeySchema) } },
    },
    async (req) => {
      const { limit, offset } = req.query;
      const [rows, [total]] = await Promise.all([
        app.db
          .select({ key: apiKeys, username: users.username })
          .from(apiKeys)
          .innerJoin(users, eq(users.id, apiKeys.userId))
          .orderBy(desc(apiKeys.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(apiKeys),
      ]);
      return {
        items: rows.map(({ key, username }) => toApiKeyDto(key, { id: key.userId, username })),
        total: total?.n ?? 0,
        limit,
        offset,
      };
    },
  );

  app.delete(
    '/admin/api-keys/:id',
    {
      preHandler: app.requirePermission('apikeys.manage'),
      schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await app.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, req.params.id));
      await audit(app.db, {
        actorId: me.id,
        action: 'apikey.revoke',
        targetType: 'api_key',
        targetId: req.params.id,
        ip: req.ip,
      });
      return reply.status(204).send(null);
    },
  );
}
