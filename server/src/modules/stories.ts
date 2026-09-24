import { can, createStorySchema, storySchema } from '@ovl/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { stories, storyViews, users } from '../db/schema';
import { audit } from '../lib/audit';
import { forbidden, notFound } from '../lib/errors';
import { iso, summaryColumns, toUserSummary } from '../lib/mappers';
import { currentUser } from '../plugins/auth';

/**
 * Service stories: short-lived announcements that council members, admins and the owner
 * publish from any client; every client shows them in a stories bar.
 */
export async function storyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['stories'];
  app.addHook('preHandler', app.authenticate);

  const storyDtos = async (rows: (typeof stories.$inferSelect)[], viewerId: string) => {
    if (!rows.length) return [];
    const ids = rows.map((s) => s.id);
    const [authors, views, mine] = await Promise.all([
      app.db
        .select(summaryColumns(users))
        .from(users)
        .where(
          inArray(
            users.id,
            rows.map((s) => s.authorId),
          ),
        ),
      app.db
        .select({ storyId: storyViews.storyId, n: sql<number>`count(*)::int` })
        .from(storyViews)
        .where(inArray(storyViews.storyId, ids))
        .groupBy(storyViews.storyId),
      app.db
        .select({ storyId: storyViews.storyId })
        .from(storyViews)
        .where(and(inArray(storyViews.storyId, ids), eq(storyViews.userId, viewerId))),
    ]);
    const authorBy = new Map(authors.map((u) => [u.id, toUserSummary(u)]));
    const viewsBy = new Map(views.map((v) => [v.storyId, v.n]));
    const seen = new Set(mine.map((v) => v.storyId));
    return rows.map((s) => ({
      id: s.id,
      author: authorBy.get(s.authorId)!,
      text: s.text,
      mediaUrl: s.mediaUrl,
      linkUrl: s.linkUrl,
      background: s.background,
      viewed: seen.has(s.id),
      viewsCount: viewsBy.get(s.id) ?? 0,
      createdAt: iso(s.createdAt),
      expiresAt: iso(s.expiresAt),
    }));
  };

  app.get('/stories', { schema: { tags, response: { 200: z.array(storySchema) } } }, async (req) => {
    const rows = await app.db
      .select()
      .from(stories)
      .where(gt(stories.expiresAt, new Date()))
      .orderBy(desc(stories.createdAt))
      .limit(100);
    return storyDtos(rows, currentUser(req).id);
  });

  app.post(
    '/stories',
    {
      preHandler: app.requirePermission('stories.publish'),
      schema: {
        tags,
        description: 'Council, admins and the owner only.',
        body: createStorySchema,
        response: { 201: storySchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { durationHours, ...rest } = req.body;
      const [story] = await app.db
        .insert(stories)
        .values({ ...rest, authorId: me.id, expiresAt: new Date(Date.now() + durationHours * 3_600_000) })
        .returning();
      await audit(app.db, {
        actorId: me.id,
        action: 'story.publish',
        targetType: 'story',
        targetId: story!.id,
        ip: req.ip,
      });
      app.hub.broadcast({ type: 'story.created', storyId: story!.id });
      const [dto] = await storyDtos([story!], me.id);
      return reply.status(201).send(dto!);
    },
  );

  app.post(
    '/stories/:id/view',
    { schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      await app.db
        .insert(storyViews)
        .values({ storyId: req.params.id, userId: currentUser(req).id })
        .onConflictDoNothing();
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/stories/:id',
    { schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      const me = currentUser(req);
      const [story] = await app.db.select().from(stories).where(eq(stories.id, req.params.id));
      if (!story) throw notFound('Story');
      if (story.authorId !== me.id && !can(me.role, 'users.manage')) throw forbidden();
      await app.db.delete(stories).where(eq(stories.id, story.id));
      await audit(app.db, {
        actorId: me.id,
        action: 'story.delete',
        targetType: 'story',
        targetId: story.id,
        ip: req.ip,
      });
      return reply.status(204).send(null);
    },
  );
}
