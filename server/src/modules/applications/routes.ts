import {
  canRenew,
  RENEWAL_GRACE_DAYS,
  RENEWAL_OPENS_DAYS,
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
  attachmentIdsSchema,
  resubmitApplicationSchema,
  WORKFLOWS,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  applicationReviews,
  applications,
  chats,
  organizationMembers,
  registryEntries,
  stockListings,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../lib/errors';
import { currentUser, twoFactorSetupRequired, type AuthUser } from '../../plugins/auth';
import { publishMessage } from '../chats/service';
import { attachFiles } from '../files';
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
import { queueNotification } from '../../lib/notify';
import { label, text } from '../../lib/i18n';

export async function applicationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['applications'];
  const idParams = z.object({ id: z.uuid() });
  app.addHook('preHandler', app.authenticate);

  const one = async (row: ApplicationRow) => (await applicationDtos(app, [row]))[0]!;

  const afterCommit = async (row: ApplicationRow, announcements: Announcement[]) => {
    for (const { chat, message } of announcements) await publishMessage(app, chat, message);
    const kind = label(WORKFLOWS[row.type].label);
    const outcome = {
      approved: text`Your application was approved: ${kind}`,
      rejected: text`Your application was not approved: ${kind}`,
      changes_requested: text`Your application needs changes: ${kind}`,
    }[row.status as 'approved'];
    if (outcome)
      await queueNotification(app.db, [row.applicantId], {
        type: 'application',
        title: outcome,
        body: row.status === 'changes_requested' ? 'See what to change and send it again.' : '',
        link: '/applications',
      });
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
        throw badRequest(text`Your current role cannot apply to join the ${input.type}`);
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
        if (taken) throw conflict(text`Ticker ${p.listing.ticker} is already used on the exchange`);
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
    if (input.type === 'renewal') {
      const [entry] = await app.db
        .select()
        .from(registryEntries)
        .where(eq(registryEntries.id, input.payload.registryEntryId));
      if (!entry || entry.kind === 'organization') throw notFound('Licence');
      if (entry.holderUserId !== me.id) {
        const [member] = entry.holderOrganizationId
          ? await app.db
              .select({ role: organizationMembers.role })
              .from(organizationMembers)
              .where(
                and(
                  eq(organizationMembers.organizationId, entry.holderOrganizationId),
                  eq(organizationMembers.userId, me.id),
                ),
              )
          : [];
        if (member?.role !== 'owner' && member?.role !== 'director')
          throw forbidden('Only the holder (or the company owner or a director) can renew a licence');
      }
      if (!canRenew({ status: entry.status, expiresAt: entry.expiresAt?.toISOString() ?? null }))
        throw badRequest(
          entry.expiresAt
            ? `Renewals open ${RENEWAL_OPENS_DAYS} days before expiry and close ${RENEWAL_GRACE_DAYS} days after it`
            : 'This licence does not expire',
        );
      const [pending] = await app.db
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.type, 'renewal'),
            inArray(applications.status, ['pending', 'changes_requested']),
            sql`${applications.payload} ->> 'registryEntryId' = ${entry.id}`,
          ),
        );
      if (pending) throw conflict('A renewal of this licence is already waiting for moderation');
      // Reviewers see what is being renewed.
      input.payload.registryNumber = entry.number;
      input.payload.title = entry.title;
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
        body: createApplicationSchema.and(z.object({ attachments: attachmentIdsSchema })),
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
        await attachFiles(tx, me.id, req.body.attachments ?? [], 'application', row!.id);
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
      return applicationDtos(app, rows);
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
              round: applicationReviews.round,
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
      const done = new Set(mine.map((r) => `${r.applicationId}:${r.stageKey}:${r.round}`));
      const waiting = pending.filter((a) => {
        const stage = currentStage(a);
        return stage && canReviewStage(stage, me.role) && !done.has(`${a.id}:${stage.key}:${a.round}`);
      });
      return applicationDtos(app, waiting);
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
      return { items: await applicationDtos(app, rows), total: total?.n ?? 0, limit, offset };
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
        if (application.status !== 'pending' && application.status !== 'changes_requested')
          throw conflict(text`This application is already ${application.status}`);
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

  app.post(
    '/applications/:id/resubmit',
    {
      schema: {
        tags,
        description:
          'After a reviewer asked for changes: send the corrected application (and more files). ' +
          'The current stage is reviewed again from the start.',
        params: idParams,
        body: resubmitApplicationSchema,
        response: { 200: applicationSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const current = await app.db.select().from(applications).where(eq(applications.id, req.params.id));
      if (!current[0] || current[0].applicantId !== me.id) throw notFound('Application');
      const parsed = createApplicationSchema.safeParse({ type: current[0].type, payload: req.body.payload });
      if (!parsed.success)
        throw badRequest('The application is not valid', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      await validateSubmission(me, parsed.data);
      const { row, announcements } = await app.db.transaction(async (tx) => {
        const application = await lockApplication(tx, req.params.id);
        if (application.status !== 'changes_requested')
          throw conflict('Only applications with requested changes can be resubmitted');
        const [updated] = await tx
          .update(applications)
          .set({
            payload: parsed.data.payload,
            status: 'pending',
            round: application.round + 1,
            updatedAt: new Date(),
          })
          .where(eq(applications.id, application.id))
          .returning();
        await attachFiles(tx, me.id, req.body.attachments ?? [], 'application', application.id);
        await audit(tx, {
          actorId: me.id,
          action: 'application.resubmit',
          targetType: 'application',
          targetId: application.id,
          data: { round: updated!.round },
          ip: req.ip,
        });
        return { row: updated!, announcements: await announceStage(tx, updated!, me.username) };
      });
      await afterCommit(row, announcements);
      return one(row);
    },
  );
}
