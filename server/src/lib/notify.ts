import type { Notification, NotificationType } from '@ovl/shared';
import { inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import { iso } from './mappers';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  /** App route, e.g. /invoices or /chats/<id>. */
  link?: string | null;
}

type NotificationRow = typeof notifications.$inferSelect;

/** Pushes are for news: something that waited longer than this (the server was down) only goes to the center. */
const PUSH_MAX_AGE_MS = 6 * 3_600_000;

let queued = false;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const notificationDto = (row: NotificationRow): Notification => ({
  id: row.id,
  type: row.type as NotificationType,
  title: row.title,
  body: row.body,
  link: row.link,
  read: !!row.readAt,
  createdAt: iso(row.createdAt),
});

/**
 * Put a notification in people's notification center. Call it inside the transaction that
 * makes the change, so it exists exactly when the change does; it goes out (live and as a push)
 * after the request, or with the scheduler.
 */
export async function queueNotification(
  db: Db,
  userIds: Iterable<string | null | undefined>,
  input: NotificationInput,
) {
  const ids = [...new Set([...userIds].filter((id): id is string => !!id))];
  if (!ids.length) return;
  await db.insert(notifications).values(
    ids.map((userId) => ({
      userId,
      type: input.type,
      title: clip(input.title, 200),
      body: clip(input.body ?? '', 500),
      link: input.link ?? null,
    })),
  );
  queued = true;
}

/** Whether this process wrote notifications that have not gone out yet. */
export const hasQueuedNotifications = () => queued;

/** Send out what is waiting: live to connected apps, as a push to everyone who is away. */
export async function deliverNotifications(app: FastifyInstance, limit = 500): Promise<number> {
  queued = false;
  const rows = await app.db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notifications)
      .where(isNull(notifications.deliveredAt))
      .orderBy(notifications.createdAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length)
      await tx
        .update(notifications)
        .set({ deliveredAt: new Date() })
        .where(
          inArray(
            notifications.id,
            due.map((r) => r.id),
          ),
        );
    return due;
  });
  const online = rows.length ? await app.hub.onlineAmong(rows.map((r) => r.userId)) : new Set<string>();
  for (const row of rows) {
    app.hub.sendToUsers([row.userId], { type: 'notification.created', notification: notificationDto(row) });
    if (online.has(row.userId) || Date.now() - row.createdAt.getTime() > PUSH_MAX_AGE_MS) continue;
    app.push.sendToUsers([row.userId], { title: row.title, body: row.body, link: row.link, tag: row.type });
  }
  if (rows.length === limit) queued = true;
  return rows.length;
}
