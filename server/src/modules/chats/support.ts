import { can, chatSchema, createTicketSchema } from '@ovl/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { chatMembers, chats } from '../../db/schema';
import { badRequest, forbidden } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';
import { chatDtos, insertMessage, loadChat, publishMessage, sendToChat, sortChats } from './service';

/**
 * Tech support: every ticket is a `support` chat between the requester and the support team.
 * Moderators, admins and the owner answer from the same client ("Support desk" section);
 * their replies carry a staff badge (the owner gets a special one). Council cannot answer.
 */
export async function supportRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['support'];
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/support/tickets',
    { schema: { tags, body: createTicketSchema, response: { 201: chatSchema } } },
    async (req, reply) => {
      const me = currentUser(req);
      const { chat, message } = await app.db.transaction(async (tx) => {
        const [chat] = await tx
          .insert(chats)
          .values({ type: 'support', title: req.body.subject, ownerId: me.id, supportStatus: 'open' })
          .returning();
        await tx.insert(chatMembers).values({ chatId: chat!.id, userId: me.id, role: 'owner' });
        const message = await insertMessage(tx, { chatId: chat!.id, senderId: me.id, body: req.body.body });
        return { chat: chat!, message };
      });
      await publishMessage(app, chat, message);
      const [dto] = await chatDtos(app, [chat], me.id);
      return reply.status(201).send(dto!);
    },
  );

  app.get(
    '/support/tickets',
    { schema: { tags, description: 'Your own tickets.', response: { 200: z.array(chatSchema) } } },
    async (req) => {
      const me = currentUser(req);
      const rows = await app.db
        .select()
        .from(chats)
        .where(and(eq(chats.type, 'support'), eq(chats.ownerId, me.id)))
        .orderBy(desc(chats.createdAt));
      return sortChats(await chatDtos(app, rows, me.id));
    },
  );

  app.get(
    '/support/desk',
    {
      preHandler: app.requirePermission('support.answer'),
      schema: {
        tags,
        description: 'Support desk for moderators, admins and the owner.',
        querystring: z.object({ status: z.enum(['open', 'closed']).default('open') }),
        response: { 200: z.array(chatSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const rows = await app.db
        .select()
        .from(chats)
        .where(and(eq(chats.type, 'support'), eq(chats.supportStatus, req.query.status)))
        .orderBy(desc(chats.lastMessageAt))
        .limit(200);
      return chatDtos(app, rows, me.id);
    },
  );

  app.post(
    '/support/tickets/:id/status',
    {
      schema: {
        tags,
        description: 'Close or reopen a ticket (support staff, or the requester for their own ticket).',
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(['open', 'closed']) }),
        response: { 200: chatSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const chat = await loadChat(app.db, req.params.id);
      if (chat.type !== 'support') throw badRequest('Not a support ticket');
      const isStaff = can(me.role, 'support.answer');
      if (!isStaff && chat.ownerId !== me.id) throw forbidden();
      const [updated] = await app.db
        .update(chats)
        .set({ supportStatus: req.body.status })
        .where(eq(chats.id, chat.id))
        .returning();
      const message = await insertMessage(app.db, {
        chatId: chat.id,
        senderId: null,
        kind: 'system',
        body: `${me.displayName} ${req.body.status === 'closed' ? 'closed' : 'reopened'} the ticket`,
      });
      await publishMessage(app, updated!, message);
      await sendToChat(app, updated!, { type: 'chat.updated', chatId: chat.id });
      const [dto] = await chatDtos(app, [updated!], me.id);
      return dto!;
    },
  );
}
