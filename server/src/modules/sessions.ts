import { describeUserAgent, sessionSchema, type Session } from '@ovl/shared';
import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { refreshTokens, sessions } from '../db/schema';
import { notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import { currentUser } from '../plugins/auth';

export type SignInMethod = 'password' | 'passkey' | 'sso';

export interface ClientContext {
  userAgent: string | null;
  ip: string | null;
  /** Passkeys and single sign-on count as strong sign-ins (they satisfy the two-step rules). */
  method?: SignInMethod;
}

export function clientContext(req: FastifyRequest): ClientContext {
  return { userAgent: req.headers['user-agent']?.slice(0, 512) ?? null, ip: req.ip ?? null };
}

export async function startSession(db: Db, userId: string, ctx: ClientContext): Promise<string> {
  const [session] = await db
    .insert(sessions)
    .values({ userId, userAgent: ctx.userAgent, ip: ctx.ip, method: ctx.method ?? 'password' })
    .returning({ id: sessions.id });
  return session!.id;
}

/** Sign sessions out: their refresh tokens stop working and their live connections close. */
export async function revokeSessions(app: FastifyInstance, where: SQL | undefined): Promise<string[]> {
  const now = new Date();
  const revoked = await app.db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(isNull(sessions.revokedAt), where))
    .returning({ id: sessions.id });
  const ids = revoked.map((s) => s.id);
  if (ids.length) {
    await app.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(inArray(refreshTokens.sessionId, ids), isNull(refreshTokens.revokedAt)));
    app.hub.closeSessions(ids);
  }
  return ids;
}

type SessionRow = typeof sessions.$inferSelect;

function toSession(row: SessionRow, currentId: string | null): Session {
  const device = describeUserAgent(row.userAgent);
  return {
    id: row.id,
    device: device.name,
    kind: device.kind,
    ip: row.ip,
    createdAt: iso(row.createdAt),
    lastUsedAt: iso(row.lastUsedAt),
    current: row.id === currentId,
  };
}

export async function sessionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['me'];

  app.get(
    '/me/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Devices signed in to this account, most recently used first.',
        response: { 200: z.array(sessionSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      // A session is live while it is not signed out and still has an unexpired refresh token.
      const rows = await app.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, me.id),
            isNull(sessions.revokedAt),
            sql`exists (select 1 from ${refreshTokens} where ${refreshTokens.sessionId} = ${sessions.id}
              and ${refreshTokens.revokedAt} is null and ${refreshTokens.expiresAt} > now())`,
          ),
        )
        .orderBy(desc(sessions.lastUsedAt));
      return rows
        .map((r) => toSession(r, me.sessionId))
        .sort((a, b) => Number(b.current) - Number(a.current));
    },
  );

  app.delete(
    '/me/sessions/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Sign one device out. Its tokens stop working immediately.',
        params: z.object({ id: z.uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const ids = await revokeSessions(app, and(eq(sessions.id, req.params.id), eq(sessions.userId, me.id)));
      if (!ids.length) throw notFound('Session');
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/me/sessions/sign-out-others',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Sign out every device except the one making this request.',
        response: { 200: z.object({ signedOut: z.number().int() }) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const ids = await revokeSessions(
        app,
        and(eq(sessions.userId, me.id), me.sessionId ? ne(sessions.id, me.sessionId) : undefined),
      );
      return { signedOut: ids.length };
    },
  );
}
