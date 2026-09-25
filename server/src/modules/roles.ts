import type { Role } from '@ovl/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { loadGovernance, termEnd } from '../lib/governance';
import { syncStaffChats } from './chats/service';

/**
 * Change a platform role and keep the council / moderation chat memberships in sync. Joining the
 * council starts a term (governance term length); leaving it clears the term.
 */
export async function changeRole(db: Db, userId: string, role: Role): Promise<void> {
  const councilTermEndsAt = role === 'council' ? termEnd((await loadGovernance(db)).councilTermMonths) : null;
  await db.update(users).set({ role, councilTermEndsAt }).where(eq(users.id, userId));
  await syncStaffChats(db, userId, role);
}
