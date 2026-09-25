import {
  notificationPageSchema,
  notificationsQuery,
  pushConfigSchema,
  pushDeviceSchema,
  pushSubscriptionInputSchema,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notifications, pushSubscriptions } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { deliverNotifications, notificationDto } from '../lib/notify';
import { assertPublicUrl } from '../lib/webhooks';
import { currentUser } from '../plugins/auth';

export async function notificationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['notifications'];

  // Catch-all for notifications written outside a request (scheduled jobs) or left behind by a restart.
  app.scheduler.add({ name: 'notifications', everySeconds: 10, run: () => deliverNotifications(app) });
  app.scheduler.add({
    name: 'notifications-cleanup',
    everySeconds: 6 * 3600,
    run: async () => {
      const before = new Date(Date.now() - app.config.NOTIFICATION_RETENTION_DAYS * 86_400_000);
      await app.db.delete(notifications).where(lt(notifications.createdAt, before));
    },
  });

  const unreadCount = async (userId: string) => {
    const [row] = await app.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  };

  app.get(
    '/push/config',
    {
      schema: {
        tags,
        security: [],
        description: 'What push services this server can use, and the Web Push (VAPID) public key.',
        response: { 200: pushConfigSchema },
      },
    },
    async () => app.push.publicConfig(),
  );

  app.register(async (scoped) => {
    const api = scoped.withTypeProvider<ZodTypeProvider>();
    api.addHook('preHandler', app.authenticate);

    api.get(
      '/notifications',
      {
        schema: {
          tags,
          description:
            'Your notification center, newest first: mentions, replies, payments, invoices, approvals, ' +
            'applications and more. Page with ?before=<createdAt of the last one>.',
          querystring: notificationsQuery,
          response: { 200: notificationPageSchema },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const rows = await app.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, me.id),
              req.query.before ? lt(notifications.createdAt, new Date(req.query.before)) : undefined,
              req.query.unread === 'true' ? isNull(notifications.readAt) : undefined,
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(req.query.limit);
        return { items: rows.map(notificationDto), unreadCount: await unreadCount(me.id) };
      },
    );

    api.post(
      '/notifications/read',
      {
        schema: {
          tags,
          description: 'Mark notifications as read: the ones listed, or all of them.',
          body: z.object({ ids: z.array(z.uuid()).max(200).optional() }),
          response: { 200: z.object({ unreadCount: z.number().int() }) },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const ids = req.body.ids;
        if (!ids || ids.length)
          await app.db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(
              and(
                eq(notifications.userId, me.id),
                isNull(notifications.readAt),
                ids ? inArray(notifications.id, ids) : undefined,
              ),
            );
        return { unreadCount: await unreadCount(me.id) };
      },
    );

    api.delete(
      '/notifications/:id',
      { schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } } },
      async (req, reply) => {
        const [row] = await app.db
          .delete(notifications)
          .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, currentUser(req).id)))
          .returning();
        if (!row) throw notFound('Notification');
        return reply.status(204).send(null);
      },
    );

    // --- Devices that receive push notifications --------------------------------------------

    const deviceDto = (d: typeof pushSubscriptions.$inferSelect) => ({
      id: d.id,
      kind: d.kind as 'webpush' | 'fcm' | 'apns',
      label: d.label,
      createdAt: iso(d.createdAt),
      lastUsedAt: isoOrNull(d.lastUsedAt),
    });

    api.get(
      '/me/push-subscriptions',
      { schema: { tags, response: { 200: z.array(pushDeviceSchema) } } },
      async (req) => {
        const rows = await app.db
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, currentUser(req).id))
          .orderBy(desc(pushSubscriptions.createdAt));
        return rows.map(deviceDto);
      },
    );

    api.post(
      '/me/push-subscriptions',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags,
          description:
            'Receive push notifications on this device while you are away: a browser subscription ' +
            '(PushManager.subscribe with the key from GET /push/config) or an FCM / APNs device token. ' +
            'A device belongs to the account that registered it last.',
          body: pushSubscriptionInputSchema,
          response: { 200: pushDeviceSchema },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const body = req.body;
        const config = await app.push.publicConfig();
        if ((body.kind === 'fcm' && !config.fcm) || (body.kind === 'apns' && !config.apns))
          throw badRequest(`This server does not send ${body.kind.toUpperCase()} notifications`);
        if (body.kind === 'webpush') {
          try {
            await assertPublicUrl(body.endpoint, app.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS);
          } catch (e) {
            throw badRequest(e instanceof Error ? e.message : 'This push endpoint cannot be used');
          }
        }
        const endpoint = body.kind === 'webpush' ? body.endpoint : body.token;
        const values = {
          userId: me.id,
          kind: body.kind,
          endpoint,
          keys: body.kind === 'webpush' ? body.keys : {},
          label: body.label ?? (req.headers['user-agent'] ?? '').slice(0, 100),
          failures: 0,
        };
        const [row] = await app.db
          .insert(pushSubscriptions)
          .values(values)
          .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
          .returning();
        return deviceDto(row!);
      },
    );

    api.delete(
      '/me/push-subscriptions/:id',
      {
        schema: {
          tags,
          description: 'Stop push notifications to a device (for example when signing out on it).',
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        const [row] = await app.db
          .delete(pushSubscriptions)
          .where(
            and(eq(pushSubscriptions.id, req.params.id), eq(pushSubscriptions.userId, currentUser(req).id)),
          )
          .returning();
        if (!row) throw notFound('Device');
        return reply.status(204).send(null);
      },
    );

    api.post(
      '/me/push-subscriptions/test',
      {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        schema: {
          tags,
          description: 'Send a test notification to all your devices now.',
          response: { 200: z.object({ devices: z.number().int(), delivered: z.number().int() }) },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const subs = await app.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, me.id));
        const delivered = await app.push.sendNow(subs, {
          title: 'Notifications work',
          body: 'This is how OVL For Business tells you about new messages and payments.',
          link: '/settings',
          tag: 'test',
        });
        return { devices: subs.length, delivered };
      },
    );
  });
}
