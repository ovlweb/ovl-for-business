import type { WebhookEvent } from '@ovl/shared';
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { Db } from '../db/client';
import { webhookDeliveries, webhookEndpoints, webhookEvents } from '../db/schema';
import { openSecret } from './totp';

/** Retries after a failed attempt: 1 min, 5 min, 30 min, 2 h, 12 h; then the delivery fails. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
/** Failed deliveries in a row after which an endpoint is switched off. */
const DISABLE_AFTER = 20;
const TIMEOUT_MS = 10_000;
const HOLD_MS = 60_000;

/**
 * Record that something happened, inside the transaction that changed it: one event, and a
 * pending delivery for every active endpoint that subscribed to this type.
 */
export async function emitEvent(db: Db, type: Exclude<WebhookEvent, 'ping'>, data: Record<string, unknown>) {
  const endpoints = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.active, true), sql`${type} = any(${webhookEndpoints.events})`));
  if (!endpoints.length) return null;
  const [event] = await db.insert(webhookEvents).values({ type, data }).returning();
  await db.insert(webhookDeliveries).values(endpoints.map((e) => ({ eventId: event!.id, endpointId: e.id })));
  return event!;
}

/** Stripe-style signature: HMAC-SHA256 of "<timestamp>.<body>" with the endpoint secret. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

const privateNetworks = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
] as const)
  privateNetworks.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  privateNetworks.addSubnet(net, prefix, 'ipv6');

/** Refuse to call into the server's own network (SSRF), unless the configuration allows it. */
export async function assertPublicUrl(url: string, allowPrivate: boolean) {
  const { hostname, protocol } = new URL(url);
  if (!allowPrivate && protocol !== 'https:') throw new Error('Webhook URLs must use https');
  if (allowPrivate) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addresses) {
    const mapped = a.address.startsWith('::ffff:') ? a.address.slice(7) : a.address;
    const family = isIP(mapped) === 6 ? 'ipv6' : 'ipv4';
    if (privateNetworks.check(mapped, family)) throw new Error(`${hostname} is a private address`);
  }
}

type Claimed = {
  delivery: typeof webhookDeliveries.$inferSelect;
  endpoint: typeof webhookEndpoints.$inferSelect;
  event: typeof webhookEvents.$inferSelect;
};

async function claim(db: Db, onlyId?: string): Promise<Claimed | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints, event: webhookEvents })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
      .where(
        and(
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextAttemptAt, now),
          or(isNull(webhookDeliveries.lockedUntil), lt(webhookDeliveries.lockedUntil, now)),
          onlyId ? eq(webhookDeliveries.id, onlyId) : eq(webhookEndpoints.active, true),
        ),
      )
      .orderBy(webhookDeliveries.nextAttemptAt)
      .limit(1)
      .for('update', { of: webhookDeliveries, skipLocked: true });
    if (!row) return null;
    await tx
      .update(webhookDeliveries)
      .set({ lockedUntil: new Date(now.getTime() + HOLD_MS) })
      .where(eq(webhookDeliveries.id, row.delivery.id));
    return row;
  });
}

/** Send one claimed delivery and record how it went. */
async function send(app: FastifyInstance, { delivery, endpoint, event }: Claimed) {
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
    data: event.data,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  let status: number | null = null;
  let error: string | null = null;
  try {
    await assertPublicUrl(endpoint.url, app.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS);
    const res = await fetch(endpoint.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'OVL-For-Business-Webhooks/1',
        'x-ovl-event': event.type,
        'x-ovl-delivery': delivery.id,
        'x-ovl-signature': signPayload(openSecret(endpoint.secret, app.config.JWT_SECRET), timestamp, body),
      },
      body,
    });
    status = res.status;
    await res.body?.cancel().catch(() => undefined);
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? (e.name === 'TimeoutError' ? 'Timed out after 10 s' : e.message) : String(e);
  }
  const attempts = delivery.attempts + 1;
  const ok = error === null;
  const finalFailure = !ok && attempts >= MAX_ATTEMPTS;
  await app.db
    .update(webhookDeliveries)
    .set({
      attempts,
      responseStatus: status,
      error: error?.slice(0, 500) ?? null,
      lockedUntil: null,
      status: ok ? 'delivered' : finalFailure ? 'failed' : 'pending',
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: ok || finalFailure ? delivery.nextAttemptAt : new Date(Date.now() + BACKOFF_MS[attempts - 1]!),
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  if (ok) {
    await app.db
      .update(webhookEndpoints)
      .set({ failures: 0, lastDeliveryAt: new Date() })
      .where(eq(webhookEndpoints.id, endpoint.id));
  } else {
    const failures = endpoint.failures + 1;
    await app.db
      .update(webhookEndpoints)
      .set({
        failures,
        ...(failures >= DISABLE_AFTER
          ? { active: false, disabledReason: `Turned off after ${failures} failed deliveries in a row` }
          : {}),
      })
      .where(eq(webhookEndpoints.id, endpoint.id));
  }
  return ok;
}

/** Deliver what is due (the scheduler calls this every few seconds). */
export async function deliverWebhooks(app: FastifyInstance, limit = 100) {
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await claim(app.db);
    if (!claimed) break;
    if (await send(app, claimed)) sent++;
  }
  return sent;
}

/** Deliver one delivery now (the "send test event" button). */
export async function deliverNow(app: FastifyInstance, deliveryId: string) {
  const claimed = await claim(app.db, deliveryId);
  if (claimed) await send(app, claimed);
}
