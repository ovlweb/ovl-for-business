import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { users } from './db/schema';
import { hashPassword } from './lib/crypto';
import { getStaffChat, syncStaffChats } from './modules/chats/service';

/**
 * First-start setup: make sure the council and moderation chats exist and that
 * the single owner account is present.
 */
export async function bootstrap(app: FastifyInstance): Promise<void> {
  const { config, db } = app;
  await getStaffChat(db, 'council');
  await getStaffChat(db, 'moderation');

  const [owner] = await db.select().from(users).where(eq(users.role, 'owner'));
  if (owner) {
    await syncStaffChats(db, owner.id, 'owner');
    return;
  }
  if (!config.OWNER_PASSWORD) {
    app.log.warn(
      'No owner account exists yet. Set OWNER_PASSWORD (and OWNER_USERNAME / OWNER_EMAIL) to create it.',
    );
    return;
  }
  const [created] = await db
    .insert(users)
    .values({
      username: config.OWNER_USERNAME.toLowerCase(),
      email: config.OWNER_EMAIL.toLowerCase(),
      displayName: 'Owner',
      passwordHash: await hashPassword(config.OWNER_PASSWORD),
      role: 'owner',
      emailVerifiedAt: new Date(),
    })
    .returning();
  await syncStaffChats(db, created!.id, 'owner');
  app.log.info({ username: created!.username }, 'owner account created');
}
