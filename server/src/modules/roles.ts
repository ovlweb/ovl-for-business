import type { Role } from '@ovl/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { syncStaffChats } from './chats/service';

/** Change a platform role and keep the council / moderation chat memberships in sync. */
export async function changeRole(db: Db, userId: string, role: Role): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
  await syncStaffChats(db, userId, role);
}
