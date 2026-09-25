import { auditExportQuery, systemStatusSchema } from '@ovl/shared';
import { and, asc, count, countDistinct, eq, gt, gte, ilike, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Readable } from 'node:stream';
import {
  auditLogs,
  notifications,
  platformSettings,
  realtimePresence,
  users,
  webhookDeliveries,
} from '../db/schema';
import { audit } from '../lib/audit';
import { currentUser } from '../plugins/auth';
import { version } from '../../package.json';

const csvCell = (value: unknown) => {
  const text =
    value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  // Spreadsheet apps run cells that start with these as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const EXPORT_BATCH = 1000;

/** Health of the running platform for admins, and the structured audit log export. */
export async function operationsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['admin'];
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/admin/system',
    {
      preHandler: app.requirePermission('audit.view'),
      schema: {
        tags,
        description: 'Instances, connections, queues, background jobs and the last backup.',
        response: { 200: systemStatusSchema },
      },
    },
    async () => {
      const fresh = gt(realtimePresence.seenAt, sql`now() - interval '90 seconds'`);
      const [[presence], [waiting], [pending], [backup]] = await Promise.all([
        app.db
          .select({
            instances: countDistinct(realtimePresence.instanceId),
            users: countDistinct(realtimePresence.userId),
          })
          .from(realtimePresence)
          .where(fresh),
        app.db.select({ n: count() }).from(notifications).where(isNull(notifications.deliveredAt)),
        app.db.select({ n: count() }).from(webhookDeliveries).where(eq(webhookDeliveries.status, 'pending')),
        app.db.select().from(platformSettings).where(eq(platformSettings.key, 'backup')),
      ]);
      const withPeople = presence?.instances ?? 0;
      const [mine] = await app.db
        .select({ n: count() })
        .from(realtimePresence)
        .where(and(eq(realtimePresence.instanceId, app.hub.instanceId), fresh));
      const last = backup?.value as { at?: string; file?: string; bytes?: number } | undefined;
      return {
        instance: { id: app.hub.instanceId, uptimeSeconds: Math.round(process.uptime()), version },
        // Presence covers instances with people online; this instance counts even when it has none.
        instances: withPeople + ((mine?.n ?? 0) > 0 ? 0 : 1),
        onlineUsers: app.config.REALTIME_BROKER === 'postgres' ? (presence?.users ?? 0) : app.hub.onlineCount,
        queues: { notifications: waiting?.n ?? 0, webhooks: pending?.n ?? 0 },
        jobs: app.scheduler.status(),
        lastBackup:
          last?.at && last.file
            ? { at: new Date(last.at).toISOString(), file: last.file, bytes: Number(last.bytes ?? 0) }
            : null,
      };
    },
  );

  app.get(
    '/admin/audit-logs/export',
    {
      preHandler: app.requirePermission('audit.view'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        description:
          'The audit log as CSV or NDJSON (one JSON object per line), oldest first, for archives and SIEM tools.',
        querystring: auditExportQuery,
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { format, action, from, to } = req.query;
      const filter = and(
        action ? ilike(auditLogs.action, `${action.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
        from ? gte(auditLogs.createdAt, new Date(from)) : undefined,
        to ? lte(auditLogs.createdAt, new Date(to)) : undefined,
      );
      await audit(app.db, {
        actorId: me.id,
        action: 'audit.export',
        targetType: 'audit_log',
        data: { format, action: action ?? null, from: from ?? null, to: to ?? null },
        ip: req.ip,
      });
      const db = app.db;
      async function* rows() {
        if (format === 'csv')
          yield 'id,created_at,actor_id,actor_username,action,target_type,target_id,ip,data\n';
        let after = 0;
        for (;;) {
          const batch = await db
            .select({ log: auditLogs, username: users.username })
            .from(auditLogs)
            .leftJoin(users, eq(users.id, auditLogs.actorId))
            .where(and(filter, gt(auditLogs.id, after)))
            .orderBy(asc(auditLogs.id))
            .limit(EXPORT_BATCH);
          if (!batch.length) return;
          after = batch[batch.length - 1]!.log.id;
          yield batch
            .map(({ log, username }) =>
              format === 'csv'
                ? `${[
                    log.id,
                    log.createdAt.toISOString(),
                    log.actorId,
                    username,
                    log.action,
                    log.targetType,
                    log.targetId,
                    log.ip,
                    log.data,
                  ]
                    .map(csvCell)
                    .join(',')}\n`
                : `${JSON.stringify({
                    id: log.id,
                    createdAt: log.createdAt.toISOString(),
                    actor: log.actorId ? { id: log.actorId, username } : null,
                    action: log.action,
                    targetType: log.targetType,
                    targetId: log.targetId,
                    ip: log.ip,
                    data: log.data,
                  })}\n`,
            )
            .join('');
          if (batch.length < EXPORT_BATCH) return;
        }
      }
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header(
          'content-type',
          format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
        )
        .header(
          'content-disposition',
          `attachment; filename="audit-log-${day}.${format === 'csv' ? 'csv' : 'ndjson'}"`,
        )
        .send(Readable.from(rows()));
    },
  );
}
