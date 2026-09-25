import {
  createdWebhookSchema,
  createWebhookSchema,
  updateWebhookSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '@ovl/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { webhookDeliveries, webhookEndpoints, webhookEvents } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { sealSecret } from '../lib/totp';
import { assertPublicUrl, deliverNow, deliverWebhooks } from '../lib/webhooks';
import { currentUser } from '../plugins/auth';
import { text } from '../lib/i18n';

type EndpointRow = typeof webhookEndpoints.$inferSelect;

const MAX_ENDPOINTS = 10;
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

const endpointDto = (e: EndpointRow): WebhookEndpoint => ({
  id: e.id,
  url: e.url,
  description: e.description,
  events: e.events as WebhookEndpoint['events'],
  active: e.active,
  failures: e.failures,
  disabledReason: e.disabledReason,
  lastDeliveryAt: isoOrNull(e.lastDeliveryAt),
  createdAt: iso(e.createdAt),
});

export async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['developer webhooks'];

  app.scheduler.add({ name: 'webhooks', everySeconds: 10, run: () => deliverWebhooks(app) });

  const checkUrl = async (url: string) => {
    try {
      await assertPublicUrl(url, app.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'This URL cannot receive webhooks');
    }
  };
  const load = async (id: string, userId: string) => {
    const [row] = await app.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)));
    if (!row) throw notFound('Webhook');
    return row;
  };
  const deliveryDtos = async (endpointId: string, limit = 50): Promise<WebhookDelivery[]> => {
    const rows = await app.db
      .select({ d: webhookDeliveries, type: webhookEvents.type })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
      .where(eq(webhookDeliveries.endpointId, endpointId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
    return rows.map(({ d, type }) => ({
      id: d.id,
      eventId: d.eventId,
      event: type,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      error: d.error,
      nextAttemptAt: d.status === 'pending' ? iso(d.nextAttemptAt) : null,
      deliveredAt: isoOrNull(d.deliveredAt),
      createdAt: iso(d.createdAt),
    }));
  };

  app.register(async (scoped) => {
    const api = scoped.withTypeProvider<ZodTypeProvider>();
    api.addHook('preHandler', app.authenticate);

    api.get(
      '/webhooks',
      { schema: { tags, response: { 200: z.array(webhookEndpointSchema) } } },
      async (req) => {
        const rows = await app.db
          .select()
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.userId, currentUser(req).id))
          .orderBy(desc(webhookEndpoints.createdAt));
        return rows.map(endpointDto);
      },
    );

    api.post(
      '/webhooks',
      {
        schema: {
          tags,
          description:
            'Get registry and stock listing changes pushed to your service. Each delivery is a JSON POST ' +
            'signed with the secret returned here (X-OVL-Signature: t=<unix>,v1=<HMAC-SHA256 of "t.body">).',
          body: createWebhookSchema,
          response: { 201: createdWebhookSchema },
        },
      },
      async (req, reply) => {
        const me = currentUser(req);
        const [existing] = await app.db
          .select({ n: count() })
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.userId, me.id));
        if ((existing?.n ?? 0) >= MAX_ENDPOINTS)
          throw conflict(text`You can have at most ${MAX_ENDPOINTS} webhooks`);
        await checkUrl(req.body.url);
        const secret = newSecret();
        const [row] = await app.db
          .insert(webhookEndpoints)
          .values({
            userId: me.id,
            url: req.body.url,
            description: req.body.description ?? '',
            events: [...new Set(req.body.events)],
            secret: sealSecret(secret, app.config.JWT_SECRET),
          })
          .returning();
        return reply.status(201).send({ ...endpointDto(row!), secret });
      },
    );

    api.patch(
      '/webhooks/:id',
      {
        schema: {
          tags,
          description: 'Change the URL, events or description, or switch the endpoint off and on again.',
          params: z.object({ id: z.uuid() }),
          body: updateWebhookSchema,
          response: { 200: webhookEndpointSchema },
        },
      },
      async (req) => {
        const me = currentUser(req);
        await load(req.params.id, me.id);
        const { url, events, description, active } = req.body;
        if (url) await checkUrl(url);
        const [row] = await app.db
          .update(webhookEndpoints)
          .set({
            ...(url ? { url } : {}),
            ...(events ? { events: [...new Set(events)] } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(active !== undefined
              ? { active, ...(active ? { failures: 0, disabledReason: null } : {}) }
              : {}),
          })
          .where(eq(webhookEndpoints.id, req.params.id))
          .returning();
        return endpointDto(row!);
      },
    );

    api.delete(
      '/webhooks/:id',
      { schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } } },
      async (req, reply) => {
        await load(req.params.id, currentUser(req).id);
        await app.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, req.params.id));
        return reply.status(204).send(null);
      },
    );

    api.post(
      '/webhooks/:id/rotate-secret',
      {
        schema: {
          tags,
          description: 'A new signing secret; the old one stops working at once.',
          params: z.object({ id: z.uuid() }),
          response: { 200: createdWebhookSchema },
        },
      },
      async (req) => {
        await load(req.params.id, currentUser(req).id);
        const secret = newSecret();
        const [row] = await app.db
          .update(webhookEndpoints)
          .set({ secret: sealSecret(secret, app.config.JWT_SECRET) })
          .where(eq(webhookEndpoints.id, req.params.id))
          .returning();
        return { ...endpointDto(row!), secret };
      },
    );

    api.post(
      '/webhooks/:id/test',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags,
          description: 'Send a "ping" event to this endpoint now and report how it went.',
          params: z.object({ id: z.uuid() }),
          response: { 200: webhookDeliverySchema },
        },
      },
      async (req) => {
        const endpoint = await load(req.params.id, currentUser(req).id);
        const [event] = await app.db
          .insert(webhookEvents)
          .values({ type: 'ping', data: { webhookId: endpoint.id, message: 'Hello from OVL For Business' } })
          .returning();
        const [delivery] = await app.db
          .insert(webhookDeliveries)
          .values({ eventId: event!.id, endpointId: endpoint.id })
          .returning();
        await deliverNow(app, delivery!.id);
        const [dto] = (await deliveryDtos(endpoint.id, 50)).filter((d) => d.id === delivery!.id);
        return dto!;
      },
    );

    api.get(
      '/webhooks/:id/deliveries',
      {
        schema: {
          tags,
          description: 'The last 50 deliveries to this endpoint, newest first.',
          params: z.object({ id: z.uuid() }),
          response: { 200: z.array(webhookDeliverySchema) },
        },
      },
      async (req) => {
        await load(req.params.id, currentUser(req).id);
        return deliveryDtos(req.params.id);
      },
    );

    api.post(
      '/webhooks/:id/deliveries/:deliveryId/redeliver',
      {
        schema: {
          tags,
          description: 'Queue a delivery again (for example after fixing your endpoint).',
          params: z.object({ id: z.uuid(), deliveryId: z.uuid() }),
          response: { 200: webhookDeliverySchema },
        },
      },
      async (req) => {
        await load(req.params.id, currentUser(req).id);
        const [row] = await app.db
          .update(webhookDeliveries)
          .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null, error: null })
          .where(
            and(
              eq(webhookDeliveries.id, req.params.deliveryId),
              eq(webhookDeliveries.endpointId, req.params.id),
            ),
          )
          .returning();
        if (!row) throw notFound('Delivery');
        await deliverNow(app, row.id);
        const [dto] = (await deliveryDtos(req.params.id)).filter((d) => d.id === row.id);
        return dto!;
      },
    );
  });
}
