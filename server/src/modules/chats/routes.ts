import {
  can,
  chatMemberSchema,
  chatSchema,
  createChannelSchema,
  createGroupSchema,
  messageSchema,
  messageSearchQuery,
  messageSearchResultSchema,
  messagesQuery,
  reactionEmojiSchema,
  readReceiptSchema,
  sendMessageSchema,
  supportBadgeForRole,
  updateChatSchema,
} from '@ovl/shared';
import { and, countDistinct, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { chatMembers, chats, contacts, messageReactions, messages, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { iso, summaryColumns, toUserSummary } from '../../lib/mappers';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { attachFiles } from '../files';
import {
  chatAudience,
  chatDtos,
  createChannel,
  insertMessage,
  loadChat,
  mentionedMembers,
  messageDtos,
  notifyNewMessage,
  publishMessage,
  receiptsAllowed,
  requireReadable,
  sendToChat,
  sortChats,
  type ChatRow,
  type MessageRow,
} from './service';

export async function chatRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['chats'];
  const idParams = z.object({ id: z.uuid() });
  app.addHook('preHandler', app.authenticate);

  const oneChat = async (chat: ChatRow, user: AuthUser) => (await chatDtos(app, [chat], user.id))[0]!;

  const notifyChat = async (chat: ChatRow, extraUserIds: string[] = []) => {
    await sendToChat(app, chat, { type: 'chat.updated', chatId: chat.id });
    app.hub.sendToUsers(extraUserIds, { type: 'chat.updated', chatId: chat.id });
  };

  const assertContacts = async (ownerId: string, userIds: string[]) => {
    if (!userIds.length) return;
    const rows = await app.db
      .select({ id: contacts.contactId })
      .from(contacts)
      .where(and(eq(contacts.ownerId, ownerId), inArray(contacts.contactId, userIds)));
    const known = new Set(rows.map((r) => r.id));
    const missing = userIds.filter((id) => !known.has(id));
    if (missing.length) throw badRequest('You can only invite people from your contacts', { missing });
  };

  const requireChatAdmin = async (chat: ChatRow, user: AuthUser) => {
    const [member] = await app.db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, user.id)));
    if (member?.role !== 'owner' && member?.role !== 'admin') throw forbidden('Only chat admins can do this');
  };

  app.get(
    '/chats',
    {
      schema: {
        tags,
        description: 'Chats you are a member of (tech-support tickets live under /support).',
        response: { 200: z.array(chatSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const rows = await app.db
        .select({ chat: chats })
        .from(chats)
        .innerJoin(chatMembers, and(eq(chatMembers.chatId, chats.id), eq(chatMembers.userId, me.id)))
        .where(inArray(chats.type, ['direct', 'group', 'channel', 'council', 'moderation']));
      return sortChats(
        await chatDtos(
          app,
          rows.map((r) => r.chat),
          me.id,
        ),
      );
    },
  );

  app.get(
    '/chats/:id',
    { schema: { tags, params: idParams, response: { 200: chatSchema } } },
    async (req) => {
      const me = currentUser(req);
      const { chat } = await requireReadable(app.db, req.params.id, me);
      return oneChat(chat, me);
    },
  );

  app.post(
    '/chats/direct',
    {
      schema: {
        tags,
        description: 'Open (or get) the direct chat with a user.',
        body: z.object({ userId: z.uuid() }),
        response: { 200: chatSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      if (req.body.userId === me.id) throw badRequest('You cannot chat with yourself');
      const [peer] = await app.db.select().from(users).where(eq(users.id, req.body.userId));
      if (!peer || peer.status !== 'active') throw notFound('User');
      const directKey = [me.id, peer.id].sort().join(':');
      const chat = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chats)
          .values({ type: 'direct', directKey })
          .onConflictDoNothing()
          .returning();
        if (created) {
          await tx.insert(chatMembers).values([
            { chatId: created.id, userId: me.id },
            { chatId: created.id, userId: peer.id },
          ]);
          return created;
        }
        const [existing] = await tx.select().from(chats).where(eq(chats.directKey, directKey));
        return existing!;
      });
      return oneChat(chat, me);
    },
  );

  app.post(
    '/chats/groups',
    { schema: { tags, body: createGroupSchema, response: { 201: chatSchema } } },
    async (req, reply) => {
      const me = currentUser(req);
      const memberIds = [...new Set(req.body.memberIds)].filter((id) => id !== me.id);
      await assertContacts(me.id, memberIds);
      const chat = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chats)
          .values({
            type: 'group',
            title: req.body.title,
            description: req.body.description ?? '',
            ownerId: me.id,
          })
          .returning();
        await tx
          .insert(chatMembers)
          .values([
            { chatId: created!.id, userId: me.id, role: 'owner' as const },
            ...memberIds.map((userId) => ({ chatId: created!.id, userId })),
          ]);
        await insertMessage(tx, {
          chatId: created!.id,
          senderId: null,
          kind: 'system',
          body: `${me.displayName} created the group "${req.body.title}"`,
        });
        return created!;
      });
      await notifyChat(chat);
      return reply.status(201).send(await oneChat(chat, me));
    },
  );

  app.post(
    '/chats/channels',
    {
      preHandler: app.requirePermission('channels.create'),
      schema: {
        tags,
        description:
          'Create a news channel directly (moderation only; everyone else applies with a news_channel application).',
        body: createChannelSchema,
        response: { 201: chatSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const [taken] = await app.db
        .select({ id: chats.id })
        .from(chats)
        .where(eq(chats.handle, req.body.handle));
      if (taken) throw conflict('This channel handle is already taken');
      const chat = await app.db.transaction(async (tx) => {
        const created = await createChannel(tx, { ...req.body, ownerId: req.body.ownerId ?? me.id });
        await audit(tx, {
          actorId: me.id,
          action: 'channel.create',
          targetType: 'chat',
          targetId: created.id,
          data: { handle: req.body.handle },
          ip: req.ip,
        });
        return created;
      });
      return reply.status(201).send(await oneChat(chat, me));
    },
  );

  app.get(
    '/channels',
    {
      schema: {
        tags,
        description: 'Discover public news channels.',
        querystring: z.object({ q: z.string().trim().max(64).optional() }),
        response: { 200: z.array(chatSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const pattern = req.query.q ? `%${req.query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const rows = await app.db
        .select()
        .from(chats)
        .where(
          and(
            eq(chats.type, 'channel'),
            eq(chats.isPublic, true),
            pattern ? or(ilike(chats.title, pattern), ilike(chats.handle, pattern)) : undefined,
          ),
        )
        .orderBy(desc(chats.lastMessageAt))
        .limit(50);
      return chatDtos(app, rows, me.id);
    },
  );

  app.patch(
    '/chats/:id',
    { schema: { tags, params: idParams, body: updateChatSchema, response: { 200: chatSchema } } },
    async (req) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      if (!['group', 'channel'].includes(chat.type)) throw badRequest('This chat cannot be edited');
      if (req.body.commentsEnabled !== undefined && chat.type !== 'channel')
        throw badRequest('Only channels have comments');
      await requireChatAdmin(chat, me);
      const [updated] = await app.db.update(chats).set(req.body).where(eq(chats.id, chat.id)).returning();
      await notifyChat(updated!);
      return oneChat(updated!, me);
    },
  );

  app.patch(
    '/chats/:id/pin',
    {
      schema: {
        tags,
        params: idParams,
        body: z.object({ pinned: z.boolean() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await app.db
        .update(chatMembers)
        .set({ pinned: req.body.pinned })
        .where(and(eq(chatMembers.chatId, req.params.id), eq(chatMembers.userId, me.id)));
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/chats/:id/members',
    { schema: { tags, params: idParams, response: { 200: z.array(chatMemberSchema) } } },
    async (req) => {
      const me = currentUser(req);
      const { chat, access } = await requireReadable(app.db, req.params.id, me);
      if (chat.type === 'channel' && !access.member?.role.match(/owner|admin/)) {
        throw forbidden('Only channel admins can see subscribers');
      }
      const rows = await app.db
        .select({ ...summaryColumns(users), memberRole: chatMembers.role, joinedAt: chatMembers.joinedAt })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(eq(chatMembers.chatId, chat.id))
        .orderBy(chatMembers.joinedAt)
        .limit(500);
      return rows.map((r) => ({ user: toUserSummary(r), role: r.memberRole, joinedAt: iso(r.joinedAt) }));
    },
  );

  app.post(
    '/chats/:id/members',
    {
      schema: {
        tags,
        description: 'Invite people from your contacts to a group.',
        params: idParams,
        body: z.object({ userIds: z.array(z.uuid()).min(1).max(100) }),
        response: { 200: chatSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      if (chat.type !== 'group') throw badRequest('Members can only be invited to groups');
      await requireChatAdmin(chat, me);
      const userIds = [...new Set(req.body.userIds)].filter((id) => id !== me.id);
      await assertContacts(me.id, userIds);
      const added = await app.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(chatMembers)
          .values(userIds.map((userId) => ({ chatId: chat.id, userId })))
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          const names = await tx
            .select({ displayName: users.displayName })
            .from(users)
            .where(
              inArray(
                users.id,
                inserted.map((m) => m.userId),
              ),
            );
          await insertMessage(tx, {
            chatId: chat.id,
            senderId: null,
            kind: 'system',
            body: `${me.displayName} added ${names.map((n) => n.displayName).join(', ')}`,
          });
        }
        return inserted;
      });
      if (added.length) await notifyChat(chat);
      return oneChat(chat, me);
    },
  );

  app.delete(
    '/chats/:id/members/:userId',
    {
      schema: {
        tags,
        description: 'Leave a chat (your own id) or remove someone from a group (admins).',
        params: z.object({ id: z.uuid(), userId: z.uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      if (['council', 'moderation', 'direct', 'support'].includes(chat.type)) {
        throw badRequest('You cannot leave this chat');
      }
      if (req.params.userId !== me.id) await requireChatAdmin(chat, me);
      if (req.params.userId === chat.ownerId)
        throw badRequest('The owner cannot leave; delete or transfer it instead');
      const [removed] = await app.db
        .delete(chatMembers)
        .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, req.params.userId)))
        .returning();
      if (removed && chat.type === 'group') {
        const [user] = await app.db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, req.params.userId));
        const body =
          req.params.userId === me.id
            ? `${me.displayName} left the group`
            : `${me.displayName} removed ${user?.displayName ?? 'a member'}`;
        const message = await insertMessage(app.db, {
          chatId: chat.id,
          senderId: null,
          kind: 'system',
          body,
        });
        await publishMessage(app, chat, message);
      }
      app.hub.sendToUsers([req.params.userId], { type: 'chat.removed', chatId: chat.id });
      await notifyChat(chat);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/chats/:id/join',
    {
      schema: {
        tags,
        description: 'Subscribe to a public news channel.',
        params: idParams,
        response: { 200: chatSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      if (chat.type !== 'channel' || !chat.isPublic) throw badRequest('Only public channels can be joined');
      await app.db.insert(chatMembers).values({ chatId: chat.id, userId: me.id }).onConflictDoNothing();
      return oneChat(chat, me);
    },
  );

  app.get(
    '/chats/:id/messages',
    {
      schema: {
        tags,
        description: 'Message history, newest first. Page with ?before=<oldest id you have>.',
        params: idParams,
        querystring: messagesQuery,
        response: { 200: z.array(messageSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { chat } = await requireReadable(app.db, req.params.id, me);
      const rows = await app.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chat.id),
            isNull(messages.threadId),
            req.query.before ? lt(messages.id, req.query.before) : undefined,
          ),
        )
        .orderBy(desc(messages.id))
        .limit(req.query.limit);
      return messageDtos(app, rows, me.id);
    },
  );

  app.post(
    '/chats/:id/messages',
    { schema: { tags, params: idParams, body: sendMessageSchema, response: { 201: messageSchema } } },
    async (req, reply) => {
      const me = currentUser(req);
      const { chat, access } = await requireReadable(app.db, req.params.id, me);
      if (!access.canWrite) {
        throw forbidden(
          chat.type === 'channel' ? 'Only channel admins can post here' : 'You cannot write here',
        );
      }
      const meta: Record<string, unknown> = {};
      if (chat.type === 'support' && access.asSupportStaff) {
        meta.staffBadge = supportBadgeForRole(me.role);
      }
      const message = await app.db.transaction(async (tx) => {
        if (chat.type === 'support' && chat.supportStatus === 'closed' && !access.asSupportStaff) {
          await tx.update(chats).set({ supportStatus: 'open' }).where(eq(chats.id, chat.id));
        }
        const fileIds = [...new Set(req.body.fileIds ?? [])];
        await attachFiles(tx, me.id, fileIds, 'chat', chat.id);
        return insertMessage(tx, {
          chatId: chat.id,
          senderId: me.id,
          body: req.body.body,
          meta,
          replyToId: req.body.replyToId,
          attachmentIds: fileIds,
        });
      });
      const dto = await publishMessage(app, chat, message, 'message.created', me.id);
      await notifyNewMessage(app, chat, message, me);
      return reply.status(201).send(dto);
    },
  );

  app.patch(
    '/chats/:id/messages/:messageId',
    {
      schema: {
        tags,
        params: z.object({ id: z.uuid(), messageId: z.coerce.number().int() }),
        body: z.object({ body: z.string().trim().min(1).max(4000) }),
        response: { 200: messageSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      const mentions = await mentionedMembers(app.db, chat.id, req.body.body, me.id);
      const [updated] = await app.db
        .update(messages)
        .set({ body: req.body.body, mentions, editedAt: new Date() })
        .where(
          and(
            eq(messages.id, req.params.messageId),
            eq(messages.chatId, chat.id),
            eq(messages.senderId, me.id),
          ),
        )
        .returning();
      if (!updated || updated.deletedAt) throw notFound('Message');
      return publishMessage(app, chat, updated, 'message.updated', me.id);
    },
  );

  app.delete(
    '/chats/:id/messages/:messageId',
    {
      schema: {
        tags,
        params: z.object({ id: z.uuid(), messageId: z.coerce.number().int() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      const [message] = await app.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, req.params.messageId), eq(messages.chatId, chat.id)));
      if (!message) throw notFound('Message');
      const [member] = await app.db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, me.id)));
      const isChatAdmin = member?.role === 'owner' || member?.role === 'admin';
      if (message.senderId !== me.id && !isChatAdmin && !can(me.role, 'users.manage')) {
        throw forbidden('You can only delete your own messages');
      }
      const [deleted] = await app.db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(eq(messages.id, message.id))
        .returning();
      await publishMessage(app, chat, deleted!, 'message.updated');
      if (deleted!.threadId) await publishPost(chat, deleted!.threadId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/chats/:id/read',
    {
      schema: {
        tags,
        params: idParams,
        body: z.object({ messageId: z.number().int().min(0) }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const moved = await app.db
        .update(chatMembers)
        .set({ lastReadMessageId: req.body.messageId })
        .where(
          and(
            eq(chatMembers.chatId, req.params.id),
            eq(chatMembers.userId, me.id),
            lt(chatMembers.lastReadMessageId, req.body.messageId),
          ),
        )
        .returning();
      if (moved.length) {
        // Read receipts in direct chats and groups, for people who share them.
        const chat = await loadChat(app.db, req.params.id);
        if (
          (chat.type === 'direct' || chat.type === 'group') &&
          (await receiptsAllowed(app.db, [me.id])).has(me.id)
        ) {
          const others = (await chatAudience(app, chat)).filter((id) => id !== me.id);
          const sharing = await receiptsAllowed(app.db, others);
          app.hub.sendToUsers(
            others.filter((id) => sharing.has(id)),
            { type: 'chat.read', chatId: chat.id, userId: me.id, messageId: req.body.messageId },
          );
        }
      }
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/chats/:id/receipts',
    {
      schema: {
        tags,
        description:
          'How far each other member has read (direct chats and groups). Empty when you hide your own ' +
          'read receipts; people who hide theirs are left out.',
        params: idParams,
        response: { 200: z.array(readReceiptSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { chat, access } = await requireReadable(app.db, req.params.id, me);
      if (chat.type !== 'direct' && chat.type !== 'group')
        throw badRequest('Read receipts are for direct chats and groups');
      if (!access.member || !(await receiptsAllowed(app.db, [me.id])).has(me.id)) return [];
      const rows = await app.db
        .select({ ...summaryColumns(users), lastRead: chatMembers.lastReadMessageId })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .where(and(eq(chatMembers.chatId, chat.id), ne(chatMembers.userId, me.id)))
        .limit(500);
      const sharing = await receiptsAllowed(
        app.db,
        rows.map((r) => r.id),
      );
      return rows
        .filter((r) => sharing.has(r.id))
        .map((r) => ({ user: toUserSummary(r), lastReadMessageId: r.lastRead }));
    },
  );

  // --- Search ------------------------------------------------------------------------------

  app.get(
    '/chats/search',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        description:
          'Search messages in your chats (all words, as prefixes: "inv rep" finds "invoice report"), newest first.',
        querystring: messageSearchQuery,
        response: { 200: z.array(messageSearchResultSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const words = (req.query.q.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
      if (!words.length) return [];
      const query = words.map((w) => `${w.toLowerCase()}:*`).join(' & ');
      const rows = await app.db
        .select({ message: messages })
        .from(messages)
        .innerJoin(chatMembers, and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, me.id)))
        .where(
          and(
            req.query.chatId ? eq(messages.chatId, req.query.chatId) : undefined,
            eq(messages.kind, 'text'),
            isNull(messages.deletedAt),
            sql`to_tsvector('simple', ${messages.body}) @@ to_tsquery('simple', ${query})`,
          ),
        )
        .orderBy(desc(messages.id))
        .limit(req.query.limit);
      const found = rows.map((r) => r.message);
      const chatIds = [...new Set(found.map((m) => m.chatId))];
      const chatRows = chatIds.length
        ? await app.db.select().from(chats).where(inArray(chats.id, chatIds))
        : [];
      const chatBy = new Map((await chatDtos(app, chatRows, me.id)).map((c) => [c.id, c]));
      const dtos = await messageDtos(app, found, me.id);
      return dtos.map((message) => {
        const c = chatBy.get(message.chatId)!;
        return { chat: { id: c.id, type: c.type, title: c.title }, message };
      });
    },
  );

  // --- Reactions ---------------------------------------------------------------------------

  const MAX_EMOJIS = 20;
  const messageParams = z.object({ id: z.uuid(), messageId: z.coerce.number().int() });
  const loadMessage = async (chatId: string, messageId: number) => {
    const [message] = await app.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)));
    if (!message || message.deletedAt || message.kind !== 'text') throw notFound('Message');
    return message;
  };
  const reactable = async (req: { params: { id: string; messageId: number } }, me: AuthUser) => {
    const { chat, access } = await requireReadable(app.db, req.params.id, me);
    if (!access.member && !access.asSupportStaff) throw forbidden('Join the chat to react');
    return { chat, message: await loadMessage(chat.id, req.params.messageId) };
  };

  app.post(
    '/chats/:id/messages/:messageId/reactions',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags,
        description: 'React with an emoji (again with the same one does nothing).',
        params: messageParams,
        body: z.object({ emoji: reactionEmojiSchema }),
        response: { 200: messageSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { chat, message } = await reactable(req, me);
      const [used] = await app.db
        .select({ n: countDistinct(messageReactions.emoji) })
        .from(messageReactions)
        .where(and(eq(messageReactions.messageId, message.id), ne(messageReactions.emoji, req.body.emoji)));
      if ((used?.n ?? 0) >= MAX_EMOJIS)
        throw conflict(`A message can have at most ${MAX_EMOJIS} different reactions`);
      await app.db
        .insert(messageReactions)
        .values({ messageId: message.id, userId: me.id, emoji: req.body.emoji })
        .onConflictDoNothing();
      return publishMessage(app, chat, message, 'message.updated', me.id);
    },
  );

  app.delete(
    '/chats/:id/messages/:messageId/reactions',
    {
      schema: {
        tags,
        description: 'Take back your reaction.',
        params: messageParams,
        querystring: z.object({ emoji: reactionEmojiSchema }),
        response: { 200: messageSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { chat, message } = await reactable(req, me);
      await app.db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, message.id),
            eq(messageReactions.userId, me.id),
            eq(messageReactions.emoji, req.query.emoji),
          ),
        );
      return publishMessage(app, chat, message, 'message.updated', me.id);
    },
  );

  // --- Comments under channel posts --------------------------------------------------------

  /** Tell everyone the post's comment count changed. */
  const publishPost = async (chat: ChatRow, postId: number) => {
    const [post] = await app.db.select().from(messages).where(eq(messages.id, postId));
    if (post) await publishMessage(app, chat, post, 'message.updated');
  };
  const loadPost = async (chat: ChatRow, messageId: number): Promise<MessageRow> => {
    if (chat.type !== 'channel') throw badRequest('Only channel posts have comments');
    const post = await loadMessage(chat.id, messageId);
    if (post.threadId) throw badRequest('Comments cannot have comments');
    return post;
  };

  app.get(
    '/chats/:id/messages/:messageId/comments',
    {
      schema: {
        tags,
        description: 'Comments under a channel post, newest first. Page with ?before=<oldest id you have>.',
        params: messageParams,
        querystring: messagesQuery,
        response: { 200: z.array(messageSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { chat } = await requireReadable(app.db, req.params.id, me);
      const post = await loadPost(chat, req.params.messageId);
      const rows = await app.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.threadId, post.id),
            req.query.before ? lt(messages.id, req.query.before) : undefined,
          ),
        )
        .orderBy(desc(messages.id))
        .limit(req.query.limit);
      return messageDtos(app, rows, me.id);
    },
  );

  app.post(
    '/chats/:id/messages/:messageId/comments',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        description: 'Comment on a channel post (subscribers, when the channel allows comments).',
        params: messageParams,
        body: sendMessageSchema,
        response: { 201: messageSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { chat, access } = await requireReadable(app.db, req.params.id, me);
      const post = await loadPost(chat, req.params.messageId);
      if (!access.member) throw forbidden('Subscribe to the channel to comment');
      if (!chat.commentsEnabled) throw forbidden('Comments are turned off in this channel');
      const comment = await app.db.transaction(async (tx) => {
        const fileIds = [...new Set(req.body.fileIds ?? [])];
        await attachFiles(tx, me.id, fileIds, 'chat', chat.id);
        return insertMessage(tx, {
          chatId: chat.id,
          senderId: me.id,
          body: req.body.body,
          replyToId: req.body.replyToId,
          threadId: post.id,
          attachmentIds: fileIds,
        });
      });
      const dto = await publishMessage(app, chat, comment, 'message.created', me.id);
      await publishPost(chat, post.id);
      await notifyNewMessage(app, chat, comment, me);
      return reply.status(201).send(dto);
    },
  );
}
