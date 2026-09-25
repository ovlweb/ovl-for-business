import { and, eq, inArray, lt, ne, gt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type postgres from 'postgres';
import type { Database } from '../db/client';
import { realtimeEvents, realtimePresence } from '../db/schema';
import type { Broker, Envelope, RealtimeHub } from './hub';

const CHANNEL = 'ovl_realtime';
/** NOTIFY payloads must stay under 8000 bytes; larger events travel through a table. */
const MAX_NOTIFY_BYTES = 7000;
const HEARTBEAT_MS = 30_000;
/** Presence rows older than this belong to an instance that stopped without cleaning up. */
const STALE_SECONDS = 90;

/**
 * Realtime across instances with Postgres: events go out with NOTIFY and every instance LISTENs,
 * and who is connected where lives in `realtime_presence`. Nothing to run besides the database.
 */
export class PostgresBroker implements Broker {
  private listener: { unlisten: () => Promise<void> } | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Presence changes are applied in order (a quick connect and disconnect must end offline). */
  private presenceQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: postgres.Sql,
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start() {
    this.listener = await this.client.listen(CHANNEL, (payload) => void this.onNotify(payload));
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.listener?.unlisten().catch(() => undefined);
    await this.presenceQueue.catch(() => undefined);
    await this.db
      .delete(realtimePresence)
      .where(eq(realtimePresence.instanceId, this.hub.instanceId))
      .catch(() => undefined);
  }

  publish(envelope: Envelope): void {
    const text = JSON.stringify(envelope);
    const send = async () => {
      if (Buffer.byteLength(text) <= MAX_NOTIFY_BYTES) return this.client.notify(CHANNEL, text);
      const [row] = await this.db
        .insert(realtimeEvents)
        .values({ payload: envelope })
        .returning({ id: realtimeEvents.id });
      return this.client.notify(CHANNEL, JSON.stringify({ o: envelope.o, r: row!.id }));
    };
    send().catch((err: unknown) => this.log.warn({ err }, 'realtime publish failed'));
  }

  presence(userId: string, online: boolean): void {
    const instanceId = this.hub.instanceId;
    this.presenceQueue = this.presenceQueue
      .then(() =>
        online
          ? this.db
              .insert(realtimePresence)
              .values({ instanceId, userId })
              .onConflictDoUpdate({
                target: [realtimePresence.instanceId, realtimePresence.userId],
                set: { seenAt: new Date() },
              })
          : this.db
              .delete(realtimePresence)
              .where(and(eq(realtimePresence.instanceId, instanceId), eq(realtimePresence.userId, userId))),
      )
      .catch((err: unknown) => this.log.warn({ err }, 'realtime presence update failed'));
  }

  async onlineElsewhere(userIds: string[]): Promise<Set<string>> {
    await this.presenceQueue;
    const rows = await this.db
      .selectDistinct({ userId: realtimePresence.userId })
      .from(realtimePresence)
      .where(
        and(
          inArray(realtimePresence.userId, userIds),
          ne(realtimePresence.instanceId, this.hub.instanceId),
          gt(realtimePresence.seenAt, sql`now() - make_interval(secs => ${STALE_SECONDS})`),
        ),
      );
    return new Set(rows.map((r) => r.userId));
  }

  /** Last in a batch: tests and shutdown wait until presence is written. */
  settled() {
    return this.presenceQueue;
  }

  private async onNotify(payload: string) {
    try {
      const parsed = JSON.parse(payload) as Envelope & { r?: number };
      if (parsed.o === this.hub.instanceId) return;
      if (parsed.r === undefined) return this.hub.receive(parsed);
      const [row] = await this.db.select().from(realtimeEvents).where(eq(realtimeEvents.id, parsed.r));
      if (row) this.hub.receive(row.payload as Envelope);
    } catch (err) {
      this.log.warn({ err }, 'realtime event could not be read');
    }
  }

  private async heartbeat() {
    try {
      await this.db
        .update(realtimePresence)
        .set({ seenAt: new Date() })
        .where(eq(realtimePresence.instanceId, this.hub.instanceId));
      await this.db
        .delete(realtimePresence)
        .where(lt(realtimePresence.seenAt, sql`now() - make_interval(secs => ${STALE_SECONDS * 2})`));
      await this.db
        .delete(realtimeEvents)
        .where(lt(realtimeEvents.createdAt, sql`now() - interval '5 minutes'`));
    } catch (err) {
      this.log.warn({ err }, 'realtime heartbeat failed');
    }
  }
}
