import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  ip?: string;
}

/** Record a privileged action. Call it inside the same transaction as the action itself. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    data: entry.data ?? {},
    ip: entry.ip ?? null,
  });
}
