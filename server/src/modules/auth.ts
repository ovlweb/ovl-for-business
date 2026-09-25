import {
  authResultSchema,
  changePasswordSchema,
  loginSchema,
  meSchema,
  preferencesSchema,
  refreshSchema,
  registerSchema,
  updateMeSchema,
} from '@ovl/shared';
import { and, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { refreshTokens, sessions, users } from '../db/schema';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { toMe } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { sendVerification } from './email';
import { clientContext, revokeSessions, startSession, type ClientContext } from './sessions';
import { checkSecondFactor, invalidTwoFactorCode, twoFactorRequired } from './two-factor';

type UserRow = typeof users.$inferSelect;

/** A refresh token re-used this long after it was rotated is treated as stolen. */
const REUSE_GRACE_MS = 60_000;

/**
 * Issue an access + refresh token pair inside a session (a new one for sign-ins, the same
 * one when refreshing).
 */
export async function issueTokens(
  app: FastifyInstance,
  user: UserRow,
  ctx: ClientContext,
  sessionId?: string,
) {
  const sid = sessionId ?? (await startSession(app.db, user.id, ctx));
  const refreshToken = randomToken(48);
  await app.db.insert(refreshTokens).values({
    userId: user.id,
    sessionId: sid,
    tokenHash: sha256(refreshToken),
    userAgent: ctx.userAgent,
    expiresAt: new Date(Date.now() + app.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  await app.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  return {
    accessToken: await app.signAccessToken(user, sid),
    refreshToken,
    expiresIn: app.config.ACCESS_TOKEN_TTL_SECONDS,
    user: { ...toMe(user), strongSession: ctx.method === 'passkey' || ctx.method === 'sso' },
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['auth'];
  const authRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.post(
    '/auth/register',
    {
      config: authRateLimit,
      schema: { tags, security: [], body: registerSchema, response: { 201: authResultSchema } },
    },
    async (req, reply) => {
      const { username, email, password, displayName } = req.body;
      const taken = await app.db
        .select({ username: users.username, email: users.email })
        .from(users)
        .where(or(eq(users.username, username), eq(users.email, email)));
      if (taken.some((u) => u.username === username)) throw conflict('This username is already taken');
      if (taken.length) throw conflict('An account with this email already exists');
      const [user] = await app.db
        .insert(users)
        .values({ username, email, displayName, passwordHash: await hashPassword(password) })
        .returning();
      await sendVerification(app, user!).catch((err) => req.log.error({ err }, 'verification email failed'));
      return reply.status(201).send(await issueTokens(app, user!, clientContext(req)));
    },
  );

  app.post(
    '/auth/login',
    {
      config: authRateLimit,
      schema: { tags, security: [], body: loginSchema, response: { 200: authResultSchema } },
    },
    async (req) => {
      const login = req.body.login.toLowerCase();
      const [user] = await app.db
        .select()
        .from(users)
        .where(or(eq(users.username, login), eq(users.email, login)));
      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        throw unauthorized('Wrong username / email or password');
      }
      if (user.status !== 'active') throw forbidden('This account is suspended');
      if (user.totpEnabledAt) {
        if (!req.body.code) throw twoFactorRequired();
        if (!(await checkSecondFactor(app, user, req.body.code))) throw invalidTwoFactorCode();
      }
      return issueTokens(app, user, clientContext(req));
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: authRateLimit,
      schema: { tags, security: [], body: refreshSchema, response: { 200: authResultSchema } },
    },
    async (req) => {
      const hash = sha256(req.body.refreshToken);
      // Rotate: the old refresh token is revoked atomically, so it can be used only once.
      const [token] = await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.tokenHash, hash),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!token) {
        // A rotated token used again long after rotation means someone else holds a copy:
        // sign the whole session out. (Two tabs refreshing at the same moment is not theft.)
        const [reused] = await app.db
          .select({ sessionId: refreshTokens.sessionId, revokedAt: refreshTokens.revokedAt })
          .from(refreshTokens)
          .where(and(eq(refreshTokens.tokenHash, hash), isNotNull(refreshTokens.revokedAt)));
        if (
          reused?.sessionId &&
          reused.revokedAt &&
          Date.now() - reused.revokedAt.getTime() > REUSE_GRACE_MS
        ) {
          await revokeSessions(app, eq(sessions.id, reused.sessionId));
          req.log.warn({ sessionId: reused.sessionId }, 'refresh token reuse detected; session signed out');
        }
        throw unauthorized('Refresh token is invalid or expired');
      }
      const ctx = clientContext(req);
      const [session] = token.sessionId
        ? await app.db
            .update(sessions)
            .set({ lastUsedAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent })
            .where(and(eq(sessions.id, token.sessionId), isNull(sessions.revokedAt)))
            .returning({ id: sessions.id })
        : [];
      if (!session) throw unauthorized('This session was signed out');
      const [user] = await app.db.select().from(users).where(eq(users.id, token.userId));
      if (!user) throw unauthorized('Account no longer exists');
      if (user.status !== 'active') throw forbidden('This account is suspended');
      return issueTokens(app, user, ctx, session.id);
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags, security: [], body: refreshSchema, response: { 204: z.null() } } },
    async (req, reply) => {
      const [token] = await app.db
        .select({ sessionId: refreshTokens.sessionId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(req.body.refreshToken)));
      if (token?.sessionId) {
        await revokeSessions(app, eq(sessions.id, token.sessionId));
      } else {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(eq(refreshTokens.tokenHash, sha256(req.body.refreshToken)), isNull(refreshTokens.revokedAt)),
          );
      }
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me',
    { preHandler: app.authenticate, schema: { tags: ['me'], response: { 200: meSchema } } },
    async (req) => {
      const [user] = await app.db
        .select()
        .from(users)
        .where(eq(users.id, currentUser(req).id));
      if (!user) throw notFound('Account');
      return { ...toMe(user), strongSession: currentUser(req).strongSession };
    },
  );

  app.patch(
    '/me',
    {
      preHandler: app.authenticate,
      schema: { tags: ['me'], body: updateMeSchema, response: { 200: meSchema } },
    },
    async (req) => {
      const [user] = await app.db
        .update(users)
        .set(req.body)
        .where(eq(users.id, currentUser(req).id))
        .returning();
      return toMe(user!);
    },
  );

  app.patch(
    '/me/preferences',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        description: 'Merge settings synced across all clients (theme, onboarding state, goals…).',
        body: preferencesSchema,
        response: { 200: meSchema },
      },
    },
    async (req) => {
      const [user] = await app.db
        .update(users)
        .set({ preferences: sql`${users.preferences} || ${JSON.stringify(req.body)}::jsonb` })
        .where(eq(users.id, currentUser(req).id))
        .returning();
      return toMe(user!);
    },
  );

  app.post(
    '/me/password',
    {
      preHandler: app.authenticate,
      config: authRateLimit,
      schema: { tags: ['me'], body: changePasswordSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const [user] = await app.db.select().from(users).where(eq(users.id, me.id));
      if (!user || !(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
        throw badRequest('Current password is wrong');
      }
      await app.db
        .update(users)
        .set({ passwordHash: await hashPassword(req.body.newPassword) })
        .where(eq(users.id, me.id));
      // Every other device must sign in again with the new password; this one stays signed in.
      await revokeSessions(
        app,
        and(eq(sessions.userId, me.id), me.sessionId ? ne(sessions.id, me.sessionId) : undefined),
      );
      if (!me.sessionId) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, me.id), isNull(refreshTokens.revokedAt)));
      }
      return reply.status(204).send(null);
    },
  );
}
