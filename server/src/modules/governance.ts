import {
  councilVotesNeeded,
  governanceSchema,
  publishTransparencySchema,
  transparencyPeriodQuery,
  transparencyReportSchema,
  transparencyStatsSchema,
  updateGovernanceSchema,
  type TransparencyStats,
} from '@ovl/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformSettings, transparencyReports, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { expireCouncilTerms, loadGovernance, termEnd, transparencyStats } from '../lib/governance';
import { iso, isoOrNull, summaryColumns, toUserSummary } from '../lib/mappers';
import { queueNotification } from '../lib/notify';
import { currentUser } from '../plugins/auth';

type ReportRow = typeof transparencyReports.$inferSelect;

/** A period given as two ISO timestamps: valid, in order, and at most two years long. */
function period(fromText: string, toText: string) {
  const from = new Date(fromText);
  const to = new Date(toText);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw badRequest('Give the period as ISO dates');
  if (to <= from) throw badRequest('The period has to end after it starts');
  if (to.getTime() - from.getTime() > 2 * 366 * 86_400_000)
    throw badRequest('A report covers at most two years');
  return { from, to };
}

export async function governanceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['governance'];

  app.scheduler.add({ name: 'council-terms', everySeconds: 3600, run: () => expireCouncilTerms(app) });

  const governance = async () => {
    const rules = await loadGovernance(app.db, app.config.COUNCIL_QUORUM);
    const council = await app.db
      .select({ ...summaryColumns(users), termEndsAt: users.councilTermEndsAt })
      .from(users)
      .where(and(eq(users.role, 'council'), eq(users.status, 'active')))
      .orderBy(users.displayName);
    return {
      ...rules,
      activeCouncilMembers: council.length,
      votesNeeded: councilVotesNeeded(rules, council.length),
      council: council.map((c) => ({ user: toUserSummary(c), termEndsAt: isoOrNull(c.termEndsAt) })),
    };
  };

  const reportDtos = async (rows: ReportRow[]) => {
    const ids = [...new Set(rows.map((r) => r.publishedBy).filter((id): id is string => !!id))];
    const people = ids.length
      ? await app.db
          .select({ id: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      periodStart: iso(r.periodStart),
      periodEnd: iso(r.periodEnd),
      notes: r.notes,
      stats: r.stats as unknown as TransparencyStats,
      publishedAt: iso(r.publishedAt),
      publishedBy: r.publishedBy ? (byId.get(r.publishedBy) ?? null) : null,
    }));
  };

  // --- Public ------------------------------------------------------------------------------

  app.get(
    '/governance',
    {
      schema: {
        tags,
        security: [],
        description: 'How council votes are decided, how long council seats last, and who is on the council.',
        response: { 200: governanceSchema },
      },
    },
    async () => governance(),
  );

  app.get(
    '/transparency',
    {
      schema: {
        tags,
        security: [],
        description: 'Published transparency reports, newest first.',
        response: { 200: z.array(transparencyReportSchema) },
      },
    },
    async () =>
      reportDtos(
        await app.db
          .select()
          .from(transparencyReports)
          .orderBy(desc(transparencyReports.periodEnd))
          .limit(100),
      ),
  );

  app.get(
    '/transparency/:id',
    {
      schema: {
        tags,
        security: [],
        params: z.object({ id: z.uuid() }),
        response: { 200: transparencyReportSchema },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select()
        .from(transparencyReports)
        .where(eq(transparencyReports.id, req.params.id));
      if (!row) throw notFound('Report');
      return (await reportDtos([row]))[0]!;
    },
  );

  // --- Staff -------------------------------------------------------------------------------

  app.put(
    '/admin/governance',
    {
      preHandler: app.requirePermission('governance.manage'),
      schema: {
        tags: ['admin'],
        description:
          'Change how council stages are decided and how long council seats last (new seats; renew existing ' +
          'ones with POST /admin/users/:id/council-term).',
        body: updateGovernanceSchema,
        response: { 200: governanceSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const current = await loadGovernance(app.db, app.config.COUNCIL_QUORUM);
      const value = { ...current, ...req.body };
      await app.db
        .insert(platformSettings)
        .values({ key: 'governance', value, updatedBy: me.id })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value, updatedBy: me.id, updatedAt: new Date() },
        });
      await audit(app.db, {
        actorId: me.id,
        action: 'governance.update',
        targetType: 'settings',
        targetId: 'governance',
        data: { from: current, to: value },
        ip: req.ip,
      });
      return governance();
    },
  );

  app.post(
    '/admin/users/:id/council-term',
    {
      preHandler: app.requirePermission('users.manage'),
      schema: {
        tags: ['admin'],
        description: 'Start a new council term for a council member now (months: 0 for no limit).',
        params: z.object({ id: z.uuid() }),
        body: z.object({ months: z.number().int().min(0).max(120) }),
        response: { 200: z.object({ termEndsAt: z.string().nullable() }) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [target] = await app.db.select().from(users).where(eq(users.id, req.params.id));
      if (!target) throw notFound('User');
      if (target.role !== 'council') throw badRequest('Only council members have a term');
      const ends = termEnd(req.body.months);
      await app.db.transaction(async (tx) => {
        await tx.update(users).set({ councilTermEndsAt: ends }).where(eq(users.id, target.id));
        await audit(tx, {
          actorId: me.id,
          action: 'council.term_renewed',
          targetType: 'user',
          targetId: target.id,
          data: { months: req.body.months, termEndsAt: ends?.toISOString() ?? null },
          ip: req.ip,
        });
        await queueNotification(tx, [target.id], {
          type: 'application',
          title: ends
            ? `Your council term now runs until ${ends.toISOString().slice(0, 10)}`
            : 'Your council seat has no term limit now',
          link: '/settings',
        });
      });
      return { termEndsAt: isoOrNull(ends) };
    },
  );

  app.get(
    '/admin/transparency/preview',
    {
      preHandler: app.requirePermission('transparency.publish'),
      schema: {
        tags: ['admin'],
        description: 'The numbers a report for this period would publish.',
        querystring: transparencyPeriodQuery,
        response: { 200: transparencyStatsSchema },
      },
    },
    async (req) => {
      const { from, to } = period(req.query.from, req.query.to);
      return transparencyStats(app.db, from, to);
    },
  );

  app.post(
    '/admin/transparency',
    {
      preHandler: app.requirePermission('transparency.publish'),
      schema: {
        tags: ['admin'],
        description: 'Publish a transparency report: the numbers for the period are frozen as they are now.',
        body: publishTransparencySchema,
        response: { 201: transparencyReportSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { from, to } = period(req.body.periodStart, req.body.periodEnd);
      const stats = await transparencyStats(app.db, from, to);
      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(transparencyReports)
          .values({
            title: req.body.title,
            periodStart: from,
            periodEnd: to,
            notes: req.body.notes,
            stats: stats as unknown as Record<string, unknown>,
            publishedBy: me.id,
          })
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: 'transparency.publish',
          targetType: 'transparency_report',
          targetId: created!.id,
          data: { title: req.body.title, periodStart: from.toISOString(), periodEnd: to.toISOString() },
          ip: req.ip,
        });
        return created!;
      });
      return reply.status(201).send((await reportDtos([row]))[0]!);
    },
  );

  app.delete(
    '/admin/transparency/:id',
    {
      preHandler: app.requirePermission('transparency.publish'),
      schema: { tags: ['admin'], params: z.object({ id: z.uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const [row] = await app.db
        .delete(transparencyReports)
        .where(eq(transparencyReports.id, req.params.id))
        .returning();
      if (!row) throw notFound('Report');
      await audit(app.db, {
        actorId: me.id,
        action: 'transparency.retract',
        targetType: 'transparency_report',
        targetId: row.id,
        data: { title: row.title },
        ip: req.ip,
      });
      return reply.status(204).send(null);
    },
  );
}
