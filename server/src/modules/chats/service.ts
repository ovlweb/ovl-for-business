import {
  can,
  COUNCIL_CHAT_ROLES,
  MODERATION_CHAT_ROLES,
  type Chat,
  type Message,
  type Role,
} from '@ovl/shared';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { chatMembers, chats, messages, users } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { iso, isoOrNull, summaryColumns, toUserSummary } from '../../lib/mappers';

export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
type MemberRow = typeof chatMembers.$inferSelect;

export const STAFF_CHAT_TITLES = { council: 'Council', moderation: 'Moderation team' } as const;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface ChatAccess {
  member: MemberRow | null;
  canRead: boolean;
  canWrite: boolean;
  /** Staff reading/answering a support ticket they are not a member of. */
  asSupportStaff: boolean;
}

export async function chatAccess(
  db: Db,
  chat: ChatRow,
  user: { id: string; role: Role },
): Promise<ChatAccess> {
  const [member] = await db
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, user.id)));
  const isMember = !!member;
  const supportStaff = chat.type === 'support' && can(user.role, 'support.answer');
  const canRead = isMember || supportStaff || (chat.type === 'channel' && chat.isPublic);
  let canWrite = isMember;
  if (chat.type === 'channel') canWrite = member?.role === 'owner' || member?.role === 'admin';
  if (chat.type === 'support') canWrite = isMember || supportStaff;
  return { member: member ?? null, canRead, canWrite, asSupportStaff: supportStaff && !isMember };
}

export async function loadChat(db: Db, chatId: string): Promise<ChatRow> {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
  if (!chat) throw notFound('Chat');
  return chat;
}

export async function requireReadable(db: Db, chatId: string, user: { id: string; role: Role }) {
  const chat = await loadChat(db, chatId);
  const access = await chatAccess(db, chat, user);
  if (!access.canRead) throw forbidden('You are not a member of this chat');
  return { chat, access };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function messageDtos(db: Db, rows: MessageRow[]): Promise<Message[]> {
  const senderIds = [...new Set(rows.map((m) => m.senderId).filter((id): id is string => !!id))];
  const senders = senderIds.length
    ? await db.select(summaryColumns(users)).from(users).where(inArray(users.id, senderIds))
    : [];
  const byId = new Map(senders.map((u) => [u.id, toUserSummary(u)]));
  return rows.map((m) => ({
    id: m.id,
    chatId: m.chatId,
    sender: m.senderId ? (byId.get(m.senderId) ?? null) : null,
    kind: m.kind,
    body: m.deletedAt ? '' : m.body,
    meta: m.meta,
    replyToId: m.replyToId,
    editedAt: isoOrNull(m.editedAt),
    deleted: !!m.deletedAt,
    createdAt: iso(m.createdAt),
  }));
}

export async function insertMessage(
  db: Db,
  input: {
    chatId: string;
    senderId: string | null;
    body: string;
    kind?: 'text' | 'system';
    meta?: Record<string, unknown>;
    replyToId?: number;
  },
): Promise<MessageRow> {
  const [message] = await db
    .insert(messages)
    .values({
      chatId: input.chatId,
      senderId: input.senderId,
      body: input.body,
      kind: input.kind ?? 'text',
      meta: input.meta ?? {},
      replyToId: input.replyToId ?? null,
    })
    .returning();
  await db.update(chats).set({ lastMessageAt: message!.createdAt }).where(eq(chats.id, input.chatId));
  if (input.senderId) {
    await db
      .update(chatMembers)
      .set({ lastReadMessageId: message!.id })
      .where(and(eq(chatMembers.chatId, input.chatId), eq(chatMembers.userId, input.senderId)));
  }
  return message!;
}

/** Everyone who should receive live events of a chat. */
export async function chatAudience(app: FastifyInstance, chat: ChatRow): Promise<string[]> {
  const rows = await app.db
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(eq(chatMembers.chatId, chat.id));
  const ids = rows.map((r) => r.userId);
  if (chat.type === 'support') ids.push(...app.hub.supportStaffIds());
  return ids;
}

export async function publishMessage(
  app: FastifyInstance,
  chat: ChatRow,
  message: MessageRow,
  type = 'message.created',
) {
  const [dto] = await messageDtos(app.db, [message]);
  app.hub.sendToUsers(await chatAudience(app, chat), {
    type: type as 'message.created' | 'message.updated',
    chatId: chat.id,
    message: dto!,
  });
  return dto!;
}

// ---------------------------------------------------------------------------
// Chat list DTOs
// ---------------------------------------------------------------------------

export async function chatDtos(db: Db, rows: ChatRow[], viewerId: string): Promise<Chat[]> {
  if (!rows.length) return [];
  const ids = rows.map((c) => c.id);

  const [counts, mine, unread, lastMessages, peers, requesters] = await Promise.all([
    db
      .select({ chatId: chatMembers.chatId, n: sql<number>`count(*)::int` })
      .from(chatMembers)
      .where(inArray(chatMembers.chatId, ids))
      .groupBy(chatMembers.chatId),
    db
      .select()
      .from(chatMembers)
      .where(and(inArray(chatMembers.chatId, ids), eq(chatMembers.userId, viewerId))),
    db
      .select({ chatId: messages.chatId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(chatMembers, and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, viewerId)))
      .where(
        and(
          inArray(messages.chatId, ids),
          sql`${messages.id} > ${chatMembers.lastReadMessageId}`,
          isNull(messages.deletedAt),
          or(isNull(messages.senderId), ne(messages.senderId, viewerId)),
        ),
      )
      .groupBy(messages.chatId),
    db
      .selectDistinctOn([messages.chatId])
      .from(messages)
      .where(and(inArray(messages.chatId, ids), isNull(messages.deletedAt)))
      .orderBy(messages.chatId, desc(messages.id)),
    db
      .select({ chatId: chatMembers.chatId, ...summaryColumns(users) })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(
        and(
          inArray(
            chatMembers.chatId,
            rows.filter((c) => c.type === 'direct').map((c) => c.id),
          ),
          ne(chatMembers.userId, viewerId),
        ),
      ),
    db
      .select(summaryColumns(users))
      .from(users)
      .where(
        inArray(
          users.id,
          rows.filter((c) => c.type === 'support' && c.ownerId).map((c) => c.ownerId!),
        ),
      ),
  ]);

  const lastDtos = await messageDtos(db, lastMessages);
  const countBy = new Map(counts.map((c) => [c.chatId, c.n]));
  const mineBy = new Map(mine.map((m) => [m.chatId, m]));
  const unreadBy = new Map(unread.map((u) => [u.chatId, u.n]));
  const lastBy = new Map(lastDtos.map((m) => [m.chatId, m]));
  const peerBy = new Map(peers.map((p) => [p.chatId, toUserSummary(p)]));
  const requesterBy = new Map(requesters.map((u) => [u.id, toUserSummary(u)]));

  return rows.map((c) => {
    const member = mineBy.get(c.id);
    const peer = peerBy.get(c.id) ?? null;
    const requester = c.ownerId ? requesterBy.get(c.ownerId) : undefined;
    return {
      id: c.id,
      type: c.type,
      title: c.type === 'direct' ? (peer?.displayName ?? 'Deleted account') : c.title,
      description: c.description,
      handle: c.handle,
      isPublic: c.isPublic,
      memberCount: countBy.get(c.id) ?? 0,
      myRole: member?.role ?? null,
      pinned: member?.pinned ?? false,
      unreadCount: unreadBy.get(c.id) ?? 0,
      lastMessage: lastBy.get(c.id) ?? null,
      peer,
      support: c.type === 'support' && requester ? { status: c.supportStatus ?? 'open', requester } : null,
      createdAt: iso(c.createdAt),
    };
  });
}

export function sortChats(list: Chat[]): Chat[] {
  const at = (c: Chat) => c.lastMessage?.createdAt ?? c.createdAt;
  return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || at(b).localeCompare(at(a)));
}

// ---------------------------------------------------------------------------
// Staff chats (council "unite" chat and moderation team), channels
// ---------------------------------------------------------------------------

export async function getStaffChat(db: Db, type: 'council' | 'moderation'): Promise<ChatRow> {
  const [existing] = await db.select().from(chats).where(eq(chats.type, type));
  if (existing) return existing;
  const [created] = await db
    .insert(chats)
    .values({
      type,
      title: STAFF_CHAT_TITLES[type],
      description:
        type === 'council'
          ? 'Council chat: registrations, licenses and companies waiting for a vote show up here.'
          : 'Moderation team chat: new applications waiting for moderation show up here.',
    })
    .returning();
  return created!;
}

/** Add / remove a user from the council and moderation chats according to their role. */
export async function syncStaffChats(db: Db, userId: string, role: Role): Promise<void> {
  for (const [type, roles] of [
    ['council', COUNCIL_CHAT_ROLES],
    ['moderation', MODERATION_CHAT_ROLES],
  ] as const) {
    const chat = await getStaffChat(db, type);
    if (roles.includes(role)) {
      await db
        .insert(chatMembers)
        .values({ chatId: chat.id, userId, role: role === 'owner' ? 'owner' : 'member', pinned: true })
        .onConflictDoNothing();
    } else {
      await db
        .delete(chatMembers)
        .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, userId)));
    }
  }
}

export async function createChannel(
  db: Db,
  input: { title: string; handle: string; description?: string; ownerId: string },
): Promise<ChatRow> {
  const [chat] = await db
    .insert(chats)
    .values({
      type: 'channel',
      title: input.title,
      handle: input.handle,
      description: input.description ?? '',
      ownerId: input.ownerId,
      isPublic: true,
    })
    .returning();
  await db.insert(chatMembers).values({ chatId: chat!.id, userId: input.ownerId, role: 'owner' });
  return chat!;
}
