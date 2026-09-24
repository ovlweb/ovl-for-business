import {
  addOrgMemberSchema,
  can,
  currencyCodeSchema,
  orgMemberSchema,
  organizationSchema,
  ORG_FINANCE_ROLES,
  updateOrganizationSchema,
  walletSchema,
  type Organization,
  type OrgRole,
} from '@ovl/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { organizationMembers, organizations, stockListings, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { iso, summaryColumns, toUserSummary } from '../lib/mappers';
import { currentUser, type AuthUser } from '../plugins/auth';
import { getOrCreateWallet, listOwnerWallets, orgRoleOf, walletDtos } from './wallets/service';

type OrgRow = typeof organizations.$inferSelect;

export async function organizationDtos(db: Db, rows: OrgRow[], viewerId?: string): Promise<Organization[]> {
  if (!rows.length) return [];
  const ids = rows.map((o) => o.id);
  const [owners, counts, listings, mine] = await Promise.all([
    db
      .select(summaryColumns(users))
      .from(users)
      .where(
        inArray(
          users.id,
          rows.map((o) => o.ownerId),
        ),
      ),
    db
      .select({ id: organizationMembers.organizationId, n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(inArray(organizationMembers.organizationId, ids))
      .groupBy(organizationMembers.organizationId),
    db
      .select({ id: stockListings.organizationId, ticker: stockListings.ticker })
      .from(stockListings)
      .where(inArray(stockListings.organizationId, ids)),
    viewerId
      ? db
          .select({ id: organizationMembers.organizationId, role: organizationMembers.role })
          .from(organizationMembers)
          .where(
            and(inArray(organizationMembers.organizationId, ids), eq(organizationMembers.userId, viewerId)),
          )
      : Promise.resolve([] as { id: string; role: OrgRole }[]),
  ]);
  const ownerById = new Map(owners.map((u) => [u.id, u]));
  const countById = new Map(counts.map((c) => [c.id, c.n]));
  const tickerById = new Map(listings.map((l) => [l.id, l.ticker]));
  const roleById = new Map(mine.map((m) => [m.id, m.role]));
  return rows.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    description: o.description,
    website: o.website,
    country: o.country,
    baseCurrency: o.baseCurrency,
    status: o.status,
    registryNumber: o.registryNumber,
    ticker: tickerById.get(o.id) ?? null,
    owner: toUserSummary(ownerById.get(o.ownerId)!),
    memberCount: countById.get(o.id) ?? 0,
    myRole: roleById.get(o.id) ?? null,
    createdAt: iso(o.createdAt),
  }));
}

export async function organizationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['organizations'];
  const idParams = z.object({ id: z.uuid() });

  const loadOrg = async (id: string) => {
    const [org] = await app.db.select().from(organizations).where(eq(organizations.id, id));
    if (!org) throw notFound('Organization');
    return org;
  };

  const requireOrgRole = async (orgId: string, user: AuthUser, roles: readonly OrgRole[]) => {
    const role = await orgRoleOf(app.db, orgId, user.id);
    if (!role || !roles.includes(role)) throw forbidden('Your role in this company does not allow this');
    return role;
  };

  app.get(
    '/organizations/mine',
    { preHandler: app.authenticate, schema: { tags, response: { 200: z.array(organizationSchema) } } },
    async (req) => {
      const me = currentUser(req);
      const rows = await app.db
        .select({ org: organizations })
        .from(organizations)
        .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, me.id))
        .orderBy(organizations.name);
      return organizationDtos(
        app.db,
        rows.map((r) => r.org),
        me.id,
      );
    },
  );

  app.get(
    '/organizations/:slug',
    {
      preHandler: app.optionalAuth,
      schema: {
        tags,
        security: [{}, { bearerAuth: [] }],
        description: 'Public company profile.',
        params: z.object({ slug: z.string() }),
        response: { 200: organizationSchema },
      },
    },
    async (req) => {
      const [org] = await app.db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, req.params.slug.toLowerCase()));
      if (!org) throw notFound('Organization');
      const [dto] = await organizationDtos(app.db, [org], req.user?.id);
      return dto!;
    },
  );

  app.patch(
    '/organizations/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        params: idParams,
        body: updateOrganizationSchema,
        response: { 200: organizationSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      await loadOrg(req.params.id);
      await requireOrgRole(req.params.id, me, ['owner', 'director']);
      const patch = { ...req.body, website: req.body.website === '' ? null : req.body.website };
      const [org] = await app.db
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, req.params.id))
        .returning();
      const [dto] = await organizationDtos(app.db, [org!], me.id);
      return dto!;
    },
  );

  app.get(
    '/organizations/:id/members',
    {
      preHandler: app.authenticate,
      schema: { tags, params: idParams, response: { 200: z.array(orgMemberSchema) } },
    },
    async (req) => {
      const me = currentUser(req);
      await loadOrg(req.params.id);
      const role = await orgRoleOf(app.db, req.params.id, me.id);
      if (!role && !can(me.role, 'users.view'))
        throw forbidden('Only company members can see the member list');
      const rows = await app.db
        .select({
          ...summaryColumns(users),
          orgRole: organizationMembers.role,
          joinedAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, req.params.id))
        .orderBy(organizationMembers.createdAt);
      return rows.map((r) => ({ user: toUserSummary(r), role: r.orgRole, joinedAt: iso(r.joinedAt) }));
    },
  );

  app.post(
    '/organizations/:id/members',
    {
      preHandler: app.authenticate,
      schema: { tags, params: idParams, body: addOrgMemberSchema, response: { 201: orgMemberSchema } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await loadOrg(req.params.id);
      await requireOrgRole(req.params.id, me, ['owner', 'director']);
      const [user] = await app.db.select().from(users).where(eq(users.username, req.body.username));
      if (!user || user.status !== 'active') throw notFound('User');
      const [member] = await app.db
        .insert(organizationMembers)
        .values({ organizationId: req.params.id, userId: user.id, role: req.body.role })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role: req.body.role },
          setWhere: sql`${organizationMembers.role} <> 'owner'`,
        })
        .returning();
      if (!member) throw badRequest('The company owner role cannot be changed');
      await audit(app.db, {
        actorId: me.id,
        action: 'organization.member_set',
        targetType: 'organization',
        targetId: req.params.id,
        data: { userId: user.id, role: req.body.role },
        ip: req.ip,
      });
      return reply
        .status(201)
        .send({ user: toUserSummary(user), role: member.role, joinedAt: iso(member.createdAt) });
    },
  );

  app.delete(
    '/organizations/:id/members/:userId',
    {
      preHandler: app.authenticate,
      schema: { tags, params: z.object({ id: z.uuid(), userId: z.uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const org = await loadOrg(req.params.id);
      if (req.params.userId === org.ownerId) throw badRequest('The company owner cannot be removed');
      if (req.params.userId !== me.id) await requireOrgRole(org.id, me, ['owner', 'director']);
      await app.db
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userId, req.params.userId),
          ),
        );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/organizations/:id/wallets',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Business balances.',
        params: idParams,
        response: { 200: z.array(walletSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      await loadOrg(req.params.id);
      if (!can(me.role, 'wallet.view_all')) await requireOrgRole(req.params.id, me, ORG_FINANCE_ROLES);
      return listOwnerWallets(app.db, { type: 'organization', id: req.params.id });
    },
  );

  app.post(
    '/organizations/:id/wallets',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Open a business balance in another currency.',
        params: idParams,
        body: z.object({ currency: currencyCodeSchema }),
        response: { 201: walletSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await loadOrg(req.params.id);
      await requireOrgRole(req.params.id, me, ORG_FINANCE_ROLES);
      const wallet = await getOrCreateWallet(
        app.db,
        { type: 'organization', id: req.params.id },
        req.body.currency,
      );
      const [dto] = await walletDtos(app.db, [wallet]);
      return reply.status(201).send(dto!);
    },
  );
}
