import { count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { notifications, webhookDeliveries } from '../db/schema';
import { Metrics } from '../lib/metrics';
import { isPrivateAddress } from '../lib/webhooks';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Metrics;
  }
}

const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * Request ids follow W3C trace context: the trace id of an incoming `traceparent`, or a new one.
 * Every log line of the request carries it, and the response names it, so a request can be
 * followed from the proxy through the logs.
 */
export function traceIdFor(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers.traceparent;
  const match = typeof header === 'string' ? TRACEPARENT.exec(header.trim().toLowerCase()) : null;
  return match && !/^0+$/.test(match[1]!) ? match[1]! : randomBytes(16).toString('hex');
}

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export async function registerObservability(app: FastifyInstance) {
  const metrics = new Metrics();
  app.decorate('metrics', metrics);

  const requests = metrics.counter('ovl_http_requests_total', 'HTTP requests answered, by route and status.');
  const duration = metrics.histogram(
    'ovl_http_request_duration_seconds',
    'Time to answer HTTP requests, by route.',
    DURATION_BUCKETS,
  );
  metrics.gauge('ovl_realtime_connections', 'People connected over WebSocket to this instance.', () => [
    { value: app.hub.onlineCount },
  ]);
  metrics.gauge('ovl_notifications_waiting', 'Notifications written but not sent out yet.', async () => {
    const [row] = await app.db
      .select({ n: count() })
      .from(notifications)
      .where(isNull(notifications.deliveredAt));
    return [{ value: row?.n ?? 0 }];
  });
  metrics.gauge(
    'ovl_webhook_deliveries_pending',
    'Webhook deliveries waiting for a (next) attempt.',
    async () => {
      const [row] = await app.db
        .select({ n: count() })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.status, 'pending'));
      return [{ value: row?.n ?? 0 }];
    },
  );
  metrics.gauge(
    'ovl_push_sent_total',
    'Push notifications sent by this instance, by service and outcome.',
    () =>
      [...app.push.sent].map(([key, value]) => {
        const [kind, outcome] = key.split(' ');
        return { labels: { kind: kind!, outcome: outcome! }, value };
      }),
    'counter',
  );
  metrics.gauge(
    'ovl_scheduler_runs_total',
    'Background job runs on this instance.',
    () => app.scheduler.status().map((j) => ({ labels: { job: j.name }, value: j.runs })),
    'counter',
  );
  metrics.gauge(
    'ovl_scheduler_failures_total',
    'Background job runs that failed on this instance.',
    () => app.scheduler.status().map((j) => ({ labels: { job: j.name }, value: j.failures })),
    'counter',
  );
  metrics.gauge('ovl_process_resident_memory_bytes', 'Resident memory of the server process.', () => [
    { value: process.memoryUsage().rss },
  ]);
  metrics.gauge('ovl_process_heap_used_bytes', 'JavaScript heap in use.', () => [
    { value: process.memoryUsage().heapUsed },
  ]);
  metrics.gauge('ovl_process_uptime_seconds', 'Seconds since the server started.', () => [
    { value: Math.round(process.uptime()) },
  ]);
  let loop = performance.eventLoopUtilization();
  metrics.gauge(
    'ovl_event_loop_utilization',
    'Share of time the event loop was busy since the last scrape.',
    () => {
      const next = performance.eventLoopUtilization();
      const value = performance.eventLoopUtilization(next, loop).utilization;
      loop = next;
      return [{ value: Number(value.toFixed(4)) }];
    },
  );

  const route = (req: FastifyRequest) => req.routeOptions.url ?? 'unmatched';

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('traceparent', `00-${req.id}-${randomBytes(8).toString('hex')}-01`);
    reply.header('server-timing', `app;dur=${reply.elapsedTime.toFixed(1)}`);
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const path = route(req);
    if (path === '/metrics') return;
    requests.inc({ method: req.method, route: path, status: reply.statusCode });
    duration.observe({ method: req.method, route: path }, reply.elapsedTime / 1000);
  });

  // Prometheus scrapes this. With METRICS_TOKEN it needs `Authorization: Bearer <token>`;
  // without, only callers on a private network (the cluster, the host) get an answer.
  app.get('/metrics', { schema: { hide: true }, config: { rateLimit: false } }, async (req, reply) => {
    const token = app.config.METRICS_TOKEN;
    const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const allowed = token
      ? given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
      : isPrivateAddress(req.ip);
    if (!allowed) return reply.status(404).send({ error: 'not_found', message: 'Not found' });
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(await metrics.render());
  });
}
