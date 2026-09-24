import type { RealtimeClientMessage } from '@ovl/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { chatMembers, users } from '../db/schema';
import { chatAudience, loadChat } from '../modules/chats/service';

/**
 * WebSocket endpoint: GET /api/v1/realtime?token=<accessToken>
 * Browsers cannot set headers on WebSocket requests, so the access token goes in the query.
 * The server pushes RealtimeEvent JSON messages; clients may send `typing` and `ping`.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true, schema: { hide: true } }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let user;
    try {
      if (!token) throw new Error('missing token');
      user = await app.resolveAccessToken(token);
    } catch {
      socket.close(4401, 'Unauthorized');
      return;
    }

    app.hub.add(user.id, user.role, socket, user.sessionId);
    await app.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    socket.send(JSON.stringify({ type: 'ready', userId: user.id }));

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('pong', () => (alive = true));

    socket.on('message', async (raw) => {
      let message: RealtimeClientMessage;
      try {
        message = JSON.parse(raw.toString()) as RealtimeClientMessage;
      } catch {
        return;
      }
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'typing' && typeof message.chatId === 'string') {
        try {
          const [member] = await app.db
            .select()
            .from(chatMembers)
            .where(and(eq(chatMembers.chatId, message.chatId), eq(chatMembers.userId, user.id)));
          if (!member) return;
          const chat = await loadChat(app.db, message.chatId);
          const audience = (await chatAudience(app, chat)).filter((id) => id !== user.id);
          app.hub.sendToUsers(audience, { type: 'typing', chatId: chat.id, userId: user.id });
        } catch (error) {
          req.log.debug({ err: error }, 'typing event failed');
        }
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      app.hub.remove(user.id, socket, user.sessionId);
    });
  });
}
