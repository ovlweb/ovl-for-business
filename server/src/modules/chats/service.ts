import {
  can,
  COUNCIL_CHAT_ROLES,
  MODERATION_CHAT_ROLES,
  type Chat,
  type Message,
  type Role,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { chatMembers, chats, files, messageReactions, messages, users } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { iso, isoOrNull, summaryColumns, toUserSummary } from '../../lib/mappers';
import { fileDtos } from '../files';
import { queueNotification } from '../../lib/notify';

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

/** Reactions of some messages, grouped by emoji in the order they were first used. */
async function reactionsOf(db: Db, messageIds: number[]) {
  const rows = messageIds.length
    ? await db
        .select()
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds))
        .orderBy(messageReactions.createdAt)
    : [];
  const byMessage = new Map<number, Map<string, Set<string>>>();
  for (const r of rows) {
    const emojis = byMessage.get(r.messageId) ?? new Map<string, Set<string>>();
    byMessage.set(r.messageId, emojis);
    const users = emojis.get(r.emoji) ?? new Set<string>();
    emojis.set(r.emoji, users);
    users.add(r.userId);
  }
  return byMessage;
}

/** Message DTOs as `viewerId` sees them (their own reactions are marked). */
export async function messageDtos(
  app: FastifyInstance,
  rows: MessageRow[],
  viewerId: string | null,
): Promise<Message[]> {
  const db = app.db;
  const senderIds = [...new Set(rows.map((m) => m.senderId).filter((id): id is string => !!id))];
  const fileIds = [...new Set(rows.filter((m) => !m.deletedAt).flatMap((m) => m.attachmentIds))];
  const postIds = rows.filter((m) => m.threadId === null).map((m) => m.id);
  const [senders, attached, reactions, comments] = await Promise.all([
    senderIds.length ? db.select(summaryColumns(users)).from(users).where(inArray(users.id, senderIds)) : [],
    fileIds.length ? db.select().from(files).where(inArray(files.id, fileIds)) : [],
    reactionsOf(
      db,
      rows.map((m) => m.id),
    ),
    postIds.length
      ? db
          .select({ threadId: messages.threadId, n: count() })
          .from(messages)
          .where(and(inArray(messages.threadId, postIds), isNull(messages.deletedAt)))
          .groupBy(messages.threadId)
      : [],
  ]);
  const byId = new Map(senders.map((u) => [u.id, toUserSummary(u)]));
  const fileById = new Map(fileDtos(app, attached).map((f) => [f.id, f]));
  const commentsBy = new Map(comments.map((c) => [c.threadId, c.n]));
  return rows.map((m) => ({
    id: m.id,
    chatId: m.chatId,
    sender: m.senderId ? (byId.get(m.senderId) ?? null) : null,
    kind: m.kind,
    body: m.deletedAt ? '' : m.body,
    meta: m.meta,
    replyToId: m.replyToId,
    threadId: m.threadId,
    attachments: m.deletedAt ? [] : m.attachmentIds.flatMap((id) => fileById.get(id) ?? []),
    mentions: m.deletedAt ? [] : m.mentions,
    reactions: m.deletedAt
      ? []
      : [...(reactions.get(m.id) ?? new Map<string, Set<string>>())].map(([emoji, who]) => ({
          emoji,
          count: who.size,
          mine: !!viewerId && who.has(viewerId),
        })),
    commentCount: commentsBy.get(m.id) ?? 0,
    editedAt: isoOrNull(m.editedAt),
    deleted: !!m.deletedAt,
    createdAt: iso(m.createdAt),
  }));
}

/** The chat members named with @username in a message body. */
export async function mentionedMembers(db: Db, chatId: string, body: string, senderId: string | null) {
  const names = [
    ...new Set([...body.matchAll(/(?<![\w@])@([a-z][a-z0-9_]{2,31})\b/gi)].map((m) => m[1]!.toLowerCase())),
  ];
  if (!names.length) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(chatMembers, and(eq(chatMembers.userId, users.id), eq(chatMembers.chatId, chatId)))
    .where(inArray(users.username, names.slice(0, 20)));
  return rows.map((r) => r.id).filter((id) => id !== senderId);
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
    threadId?: number;
    attachmentIds?: string[];
  },
): Promise<MessageRow> {
  const mentions =
    input.kind === 'system' ? [] : await mentionedMembers(db, input.chatId, input.body, input.senderId);
  const [message] = await db
    .insert(messages)
    .values({
      chatId: input.chatId,
      senderId: input.senderId,
      body: input.body,
      kind: input.kind ?? 'text',
      meta: input.meta ?? {},
      replyToId: input.replyToId ?? null,
      threadId: input.threadId ?? null,
      attachmentIds: input.attachmentIds ?? [],
      mentions,
    })
    .returning();
  // Comments under a channel post neither move the channel up nor count as unread.
  if (input.threadId) return message!;
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

/**
 * Send a new or changed message to everyone in the chat. People who reacted to it get their own
 * copy (with their reactions marked); the DTO for `viewerId` is returned.
 */
export async function publishMessage(
  app: FastifyInstance,
  chat: ChatRow,
  message: MessageRow,
  type: 'message.created' | 'message.updated' = 'message.created',
  viewerId: string | null = null,
) {
  const [base] = await messageDtos(app, [message], null);
  const reactors = new Map<string, Set<string>>();
  for (const [emoji, who] of (await reactionsOf(app.db, [message.id])).get(message.id) ?? [])
    for (const userId of who) reactors.set(userId, (reactors.get(userId) ?? new Set()).add(emoji));
  const viewFor = (userId: string | null) => {
    const mine = userId ? reactors.get(userId) : undefined;
    return mine
      ? { ...base!, reactions: base!.reactions.map((r) => ({ ...r, mine: mine.has(r.emoji) })) }
      : base!;
  };
  const audience = await chatAudience(app, chat);
  app.hub.sendToUsers(
    audience.filter((id) => !reactors.has(id)),
    { type, chatId: chat.id, message: base! },
  );
  for (const userId of audience.filter((id) => reactors.has(id)))
    app.hub.sendToUsers([userId], { type, chatId: chat.id, message: viewFor(userId) });
  return viewFor(viewerId);
}

/** Whether someone shares read receipts (a preference, on unless turned off). */
export async function receiptsAllowed(db: Db, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ id: users.id, preferences: users.preferences })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Set(rows.filter((r) => r.preferences.readReceipts !== false).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Chat list DTOs
// ---------------------------------------------------------------------------

export async function chatDtos(app: FastifyInstance, rows: ChatRow[], viewerId: string): Promise<Chat[]> {
  if (!rows.length) return [];
  const db = app.db;
  const ids = rows.map((c) => c.id);

  const [counts, mine, unread, lastMessages, peers, requesters, mentioned] = await Promise.all([
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
          isNull(messages.threadId),
          or(isNull(messages.senderId), ne(messages.senderId, viewerId)),
        ),
      )
      .groupBy(messages.chatId),
    db
      .selectDistinctOn([messages.chatId])
      .from(messages)
      .where(and(inArray(messages.chatId, ids), isNull(messages.deletedAt), isNull(messages.threadId)))
      .orderBy(messages.chatId, desc(messages.id)),
    db
      .select({
        chatId: chatMembers.chatId,
        lastRead: chatMembers.lastReadMessageId,
        ...summaryColumns(users),
      })
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
    db
      .select({ chatId: messages.chatId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(chatMembers, and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, viewerId)))
      .where(
        and(
          inArray(messages.chatId, ids),
          sql`${messages.id} > ${chatMembers.lastReadMessageId}`,
          sql`${viewerId}::uuid = any(${messages.mentions})`,
          isNull(messages.deletedAt),
        ),
      )
      .groupBy(messages.chatId),
  ]);

  const lastDtos = await messageDtos(app, lastMessages, viewerId);
  const sharing = await receiptsAllowed(db, [viewerId, ...peers.map((p) => p.id)]);
  const countBy = new Map(counts.map((c) => [c.chatId, c.n]));
  const mineBy = new Map(mine.map((m) => [m.chatId, m]));
  const unreadBy = new Map(unread.map((u) => [u.chatId, u.n]));
  const lastBy = new Map(lastDtos.map((m) => [m.chatId, m]));
  const peerBy = new Map(peers.map((p) => [p.chatId, toUserSummary(p)]));
  const peerReadBy = new Map(
    peers.map((p) => [p.chatId, sharing.has(viewerId) && sharing.has(p.id) ? p.lastRead : null]),
  );
  const mentionsBy = new Map(mentioned.map((m) => [m.chatId, m.n]));
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
      unreadMentions: mentionsBy.get(c.id) ?? 0,
      lastMessage: lastBy.get(c.id) ?? null,
      peerReadMessageId: peerReadBy.get(c.id) ?? null,
      commentsEnabled: c.commentsEnabled,
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

// ---------------------------------------------------------------------------
// Notifications about messages
// ---------------------------------------------------------------------------

const summaryOf = (m: MessageRow) =>
  m.body ||
  (m.attachmentIds.length > 1
    ? `${m.attachmentIds.length} files`
    : m.attachmentIds.length
      ? 'Sent a file'
      : '');

/**
 * After a message is sent: mentions, replies and comments on someone's post go to the
 * notification center; everyone else in a direct chat, group or ticket who is away gets a push.
 */
export async function notifyNewMessage(
  app: FastifyInstance,
  chat: ChatRow,
  message: MessageRow,
  sender: { id: string; displayName: string },
) {
  if (message.kind !== 'text') return;
  const where = chat.type === 'direct' ? '' : ` in ${chat.title}`;
  const link =
    chat.type === 'support'
      ? `/support/${chat.id}`
      : `/chats/${chat.id}?message=${message.threadId ?? message.id}`;
  const body = summaryOf(message);
  const told = new Set([sender.id]);
  const tell = async (
    userIds: (string | null | undefined)[],
    type: 'mention' | 'reply' | 'comment',
    title: string,
  ) => {
    const fresh = userIds.filter((id): id is string => !!id && !told.has(id));
    fresh.forEach((id) => told.add(id));
    await queueNotification(app.db, fresh, { type, title, body, link });
  };
  await tell(message.mentions, 'mention', `${sender.displayName} mentioned you${where}`);
  for (const [id, type, title] of [
    [message.replyToId, 'reply', `${sender.displayName} replied to you${where}`],
    [message.threadId, 'comment', `${sender.displayName} commented on your post${where}`],
  ] as const) {
    if (!id) continue;
    const [original] = await app.db
      .select({ senderId: messages.senderId })
      .from(messages)
      .where(eq(messages.id, id));
    await tell([original?.senderId], type, title);
  }

  // Everything else in private conversations: a push to people who are away (channels are news, not pushed).
  if (message.threadId || chat.type === 'channel') return;
  const away = (await chatAudience(app, chat)).filter((id) => !told.has(id) && !app.hub.isOnline(id));
  if (!away.length) return;
  const wanting = await app.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(inArray(users.id, away), sql`coalesce(${users.preferences} ->> 'pushChats', 'true') <> 'false'`),
    );
  app.push.sendToUsers(
    wanting.map((u) => u.id),
    {
      title: chat.type === 'direct' ? sender.displayName : `${sender.displayName} · ${chat.title}`,
      body: body.length > 200 ? `${body.slice(0, 199)}…` : body,
      link,
      tag: `chat-${chat.id}`,
    },
  );
}
