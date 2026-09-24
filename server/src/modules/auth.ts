import {
  authResultSchema,
  changePasswordSchema,
  loginSchema,
  meSchema,
  refreshSchema,
  registerSchema,
  updateMeSchema,
} from '@ovl/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { refreshTokens, users } from '../db/schema';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { toMe } from '../lib/mappers';
import { currentUser } from '../plugins/auth';

type UserRow = typeof users.$inferSelect;

export async function issueTokens(app: FastifyInstance, user: UserRow, userAgent?: string) {
  const refreshToken = randomToken(48);
  await app.db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    userAgent: userAgent?.slice(0, 512) ?? null,
    expiresAt: new Date(Date.now() + app.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  await app.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  return {
    accessToken: await app.signAccessToken(user),
    refreshToken,
    expiresIn: app.config.ACCESS_TOKEN_TTL_SECONDS,
    user: toMe(user),
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
      return reply.status(201).send(await issueTokens(app, user!, req.headers['user-agent']));
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
      return issueTokens(app, user, req.headers['user-agent']);
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
      if (!token) throw unauthorized('Refresh token is invalid or expired');
      const [user] = await app.db.select().from(users).where(eq(users.id, token.userId));
      if (!user) throw unauthorized('Account no longer exists');
      if (user.status !== 'active') throw forbidden('This account is suspended');
      return issueTokens(app, user, req.headers['user-agent']);
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags, security: [], body: refreshSchema, response: { 204: z.null() } } },
    async (req, reply) => {
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(refreshTokens.tokenHash, sha256(req.body.refreshToken)), isNull(refreshTokens.revokedAt)),
        );
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
      return toMe(user);
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
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(req.body.newPassword) })
          .where(eq(users.id, me.id));
        // Sign out every other session.
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, me.id), isNull(refreshTokens.revokedAt)));
      });
      return reply.status(204).send(null);
    },
  );
}
