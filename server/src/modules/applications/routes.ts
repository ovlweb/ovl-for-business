import {
  APPLICATION_STATUSES,
  APPLICATION_TYPES,
  applicationSchema,
  can,
  createApplicationSchema,
  pageOf,
  paginationQuery,
  parseAmount,
  reviewInputSchema,
  type Role,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { applicationReviews, applications, chats, organizationMembers, stockListings } from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../lib/errors';
import { currentUser, twoFactorSetupRequired, type AuthUser } from '../../plugins/auth';
import { publishMessage } from '../chats/service';
import {
  announceStage,
  applicationDtos,
  canReviewStage,
  currentStage,
  lockApplication,
  reviewApplication,
  type Announcement,
  type ApplicationRow,
} from './engine';

export async function applicationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['applications'];
  const idParams = z.object({ id: z.uuid() });
  app.addHook('preHandler', app.authenticate);

  const one = async (row: ApplicationRow) => (await applicationDtos(app.db, [row]))[0]!;

  const afterCommit = async (row: ApplicationRow, announcements: Announcement[]) => {
    for (const { chat, message } of announcements) await publishMessage(app, chat, message);
    app.hub.sendToUsers([row.applicantId], {
      type: 'application.updated',
      applicationId: row.id,
      status: row.status,
      stageIndex: row.stageIndex,
    });
  };

  /** Business rules that the payload schema alone cannot check. */
  const validateSubmission = async (me: AuthUser, input: z.infer<typeof createApplicationSchema>) => {
    if (input.type === 'moderator' || input.type === 'council') {
      const allowed: Role[] = input.type === 'moderator' ? ['user'] : ['user', 'moderator'];
      if (!allowed.includes(me.role))
        throw badRequest(`Your current role cannot apply to join the ${input.type}`);
      const [pending] = await app.db
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.applicantId, me.id),
            eq(applications.type, input.type),
            eq(applications.status, 'pending'),
          ),
        );
      if (pending) throw conflict('You already have a pending application of this kind');
    }
    if (input.type === 'company') {
      const p = input.payload;
      if (p.listOnExchange && !p.listing)
        throw badRequest('Listing details are required to list on the exchange');
      if (p.listing) {
        parseAmount(p.listing.sharePrice, p.baseCurrency);
        const [taken] = await app.db
          .select({ id: stockListings.id })
          .from(stockListings)
          .where(eq(stockListings.ticker, p.listing.ticker));
        if (taken) throw conflict(`Ticker ${p.listing.ticker} is already used on the exchange`);
      }
    }
    if (input.type === 'license' && input.payload.organizationId) {
      const [member] = await app.db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, input.payload.organizationId),
            eq(organizationMembers.userId, me.id),
          ),
        );
      if (member?.role !== 'owner' && member?.role !== 'director') {
        throw forbidden('Only the owner or a director can request a license for a company');
      }
    }
    if (input.type === 'news_channel') {
      const [taken] = await app.db
        .select({ id: chats.id })
        .from(chats)
        .where(eq(chats.handle, input.payload.handle));
      if (taken) throw conflict('This channel handle is already taken');
    }
  };

  app.post(
    '/applications',
    {
      schema: {
        tags,
        description:
          'Submit a registration suggestion: company / business account, license, joining the moderation team or the council, or a news channel.',
        body: createApplicationSchema,
        response: { 201: applicationSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      if (app.config.REQUIRE_VERIFIED_EMAIL && !me.emailVerified)
        throw new HttpError(
          403,
          'email_not_verified',
          'Confirm your email address first: we sent you a link (Settings → Account can send a new one)',
        );
      await validateSubmission(me, req.body);
      const { row, announcements } = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(applications)
          .values({ type: req.body.type, applicantId: me.id, payload: req.body.payload })
          .returning();
        const announcements = await announceStage(tx, row!, me.username);
        await audit(tx, {
          actorId: me.id,
          action: 'application.submit',
          targetType: 'application',
          targetId: row!.id,
          data: { type: row!.type },
          ip: req.ip,
        });
        return { row: row!, announcements };
      });
      await afterCommit(row, announcements);
      return reply.status(201).send(await one(row));
    },
  );

  app.get(
    '/applications/mine',
    { schema: { tags, response: { 200: z.array(applicationSchema) } } },
    async (req) => {
      const rows = await app.db
        .select()
        .from(applications)
        .where(eq(applications.applicantId, currentUser(req).id))
        .orderBy(desc(applications.createdAt));
      return applicationDtos(app.db, rows);
    },
  );

  app.get(
    '/applications/queue',
    {
      schema: {
        tags,
        description: 'Applications currently waiting for YOUR decision (moderators, council, admins, owner).',
        response: { 200: z.array(applicationSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      if (me.role === 'user' || me.role === 'manager') return [];
      const pending = await app.db
        .select()
        .from(applications)
        .where(and(eq(applications.status, 'pending'), ne(applications.applicantId, me.id)))
        .orderBy(applications.createdAt)
        .limit(500);
      const mine = pending.length
        ? await app.db
            .select({
              applicationId: applicationReviews.applicationId,
              stageKey: applicationReviews.stageKey,
            })
            .from(applicationReviews)
            .where(
              and(
                eq(applicationReviews.reviewerId, me.id),
                inArray(
                  applicationReviews.applicationId,
                  pending.map((a) => a.id),
                ),
              ),
            )
        : [];
      const done = new Set(mine.map((r) => `${r.applicationId}:${r.stageKey}`));
      const waiting = pending.filter((a) => {
        const stage = currentStage(a);
        return stage && canReviewStage(stage, me.role) && !done.has(`${a.id}:${stage.key}`);
      });
      return applicationDtos(app.db, waiting);
    },
  );

  app.get(
    '/applications',
    {
      preHandler: app.requirePermission('applications.view_all'),
      schema: {
        tags,
        description: 'All applications (staff).',
        querystring: paginationQuery.extend({
          status: z.enum(APPLICATION_STATUSES).optional(),
          type: z.enum(APPLICATION_TYPES).optional(),
        }),
        response: { 200: pageOf(applicationSchema) },
      },
    },
    async (req) => {
      const { status, type, limit, offset } = req.query;
      const where = and(
        status ? eq(applications.status, status) : undefined,
        type ? eq(applications.type, type) : undefined,
      );
      const [rows, [total]] = await Promise.all([
        app.db
          .select()
          .from(applications)
          .where(where)
          .orderBy(desc(applications.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(applications).where(where),
      ]);
      return { items: await applicationDtos(app.db, rows), total: total?.n ?? 0, limit, offset };
    },
  );

  app.get(
    '/applications/:id',
    { schema: { tags, params: idParams, response: { 200: applicationSchema } } },
    async (req) => {
      const me = currentUser(req);
      const [row] = await app.db.select().from(applications).where(eq(applications.id, req.params.id));
      if (!row) throw notFound('Application');
      if (row.applicantId !== me.id && !can(me.role, 'applications.view_all')) throw forbidden();
      return one(row);
    },
  );

  app.post(
    '/applications/:id/review',
    {
      schema: {
        tags,
        description:
          'Approve or reject the current stage. Stages with a checklist require every checklist key when approving; ' +
          'rejections require a comment.',
        params: idParams,
        body: reviewInputSchema,
        response: { 200: applicationSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      if (me.role !== me.accountRole) throw twoFactorSetupRequired();
      const outcome = await app.db.transaction(async (tx) => {
        const result = await reviewApplication(tx, app.config, req.params.id, me, req.body);
        await audit(tx, {
          actorId: me.id,
          action: `application.${req.body.decision}`,
          targetType: 'application',
          targetId: req.params.id,
          data: {
            status: result.application.status,
            stageIndex: result.application.stageIndex,
            result: result.effects?.result,
          },
          ip: req.ip,
        });
        return result;
      });
      for (const change of outcome.effects?.roleChanges ?? []) app.hub.updateRole(change.userId, change.role);
      await afterCommit(outcome.application, outcome.announcements);
      return one(outcome.application);
    },
  );

  app.post(
    '/applications/:id/withdraw',
    { schema: { tags, params: idParams, response: { 200: applicationSchema } } },
    async (req) => {
      const me = currentUser(req);
      const row = await app.db.transaction(async (tx) => {
        const application = await lockApplication(tx, req.params.id);
        if (application.applicantId !== me.id) throw forbidden();
        if (application.status !== 'pending')
          throw conflict(`This application is already ${application.status}`);
        const [updated] = await tx
          .update(applications)
          .set({ status: 'withdrawn', decidedAt: new Date(), updatedAt: new Date() })
          .where(eq(applications.id, application.id))
          .returning();
        return updated!;
      });
      return one(row);
    },
  );
}
