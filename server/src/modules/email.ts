import {
  changeEmailSchema,
  forgotPasswordSchema,
  meSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@ovl/shared';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { emailTokens, sessions, users } from '../db/schema';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors';
import { actionEmail } from '../lib/mailer';
import { toMe } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { revokeSessions } from './sessions';

type UserRow = typeof users.$inferSelect;
type Purpose = 'verify_email' | 'reset_password';

const TTL: Record<Purpose, number> = { verify_email: 48 * 3_600_000, reset_password: 3_600_000 };

const invalidLink = () =>
  new HttpError(400, 'invalid_link', 'This link is invalid or has expired. Ask for a new one.');

async function issueToken(app: FastifyInstance, user: UserRow, purpose: Purpose): Promise<string> {
  const token = randomToken(32);
  // Only the newest link of each kind works.
  await app.db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(emailTokens.userId, user.id), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)),
    );
  await app.db.insert(emailTokens).values({
    userId: user.id,
    purpose,
    tokenHash: sha256(token),
    email: user.email,
    expiresAt: new Date(Date.now() + TTL[purpose]),
  });
  return token;
}

/** Find an unused, unexpired link for the address it was sent to, and use it up. */
async function consumeToken(app: FastifyInstance, token: string, purpose: Purpose) {
  const [row] = await app.db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw invalidLink();
  const [user] = await app.db.select().from(users).where(eq(users.id, row.userId));
  if (!user || user.email !== row.email || user.status !== 'active') throw invalidLink();
  return user;
}

const link = (app: FastifyInstance, path: string, token: string) =>
  `${app.config.PUBLIC_WEB_URL.replace(/\/+$/, '')}/#/${path}?token=${token}`;

/** Send (or re-send) the "confirm your email" link. */
export async function sendVerification(app: FastifyInstance, user: UserRow): Promise<void> {
  const token = await issueToken(app, user, 'verify_email');
  await app.mailer.send(
    actionEmail({
      to: user.email,
      subject: 'Confirm your email address',
      greeting: `Hello ${user.displayName},`,
      lines: ['Please confirm this email address for your OVL For Business account.'],
      action: { label: 'Confirm email', url: link(app, 'verify-email', token) },
      footer: 'The link works for 48 hours. If you did not create an account, ignore this email.',
    }),
  );
}

export async function emailRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const strict = { rateLimit: { max: 5, timeWindow: '1 minute' } };

  app.post(
    '/me/email/verification',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: { tags: ['me'], description: 'Send a new confirmation link.', response: { 204: z.null() } },
    },
    async (req, reply) => {
      const [user] = await app.db
        .select()
        .from(users)
        .where(eq(users.id, currentUser(req).id));
      if (!user) throw notFound('Account');
      if (user.emailVerifiedAt) throw conflict('Your email address is already confirmed');
      await sendVerification(app, user);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: strict,
      schema: {
        tags: ['auth'],
        security: [],
        body: verifyEmailSchema,
        response: { 200: z.object({ email: z.string() }) },
      },
    },
    async (req) => {
      const user = await consumeToken(app, req.body.token, 'verify_email');
      await app.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
      return { email: user.email };
    },
  );

  app.post(
    '/me/email',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: {
        tags: ['me'],
        description: 'Change the email address (needs the password); the new address must be confirmed.',
        body: changeEmailSchema,
        response: { 200: meSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [user] = await app.db.select().from(users).where(eq(users.id, me.id));
      if (!user || !(await verifyPassword(req.body.password, user.passwordHash)))
        throw badRequest('The password is wrong');
      if (req.body.email === user.email) throw badRequest('This is already your email address');
      const [taken] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, req.body.email), ne(users.id, user.id)));
      if (taken) throw conflict('An account with this email already exists');
      const [updated] = await app.db
        .update(users)
        .set({ email: req.body.email, emailVerifiedAt: null })
        .where(eq(users.id, user.id))
        .returning();
      await app.mailer.send(
        actionEmail({
          to: user.email,
          subject: 'Your email address was changed',
          greeting: `Hello ${user.displayName},`,
          lines: [
            `The email address of your account is now ${req.body.email}.`,
            'If you did not do this, reset your password and contact support right away.',
          ],
        }),
      );
      await sendVerification(app, updated!);
      return toMe(updated!);
    },
  );

  app.post(
    '/auth/password/forgot',
    {
      config: strict,
      schema: {
        tags: ['auth'],
        security: [],
        description: 'Email a password reset link. Always answers 202, whether or not the address is known.',
        body: forgotPasswordSchema,
        response: { 202: z.null() },
      },
    },
    async (req, reply) => {
      const [user] = await app.db.select().from(users).where(eq(users.email, req.body.email));
      if (user && user.status === 'active') {
        const token = await issueToken(app, user, 'reset_password');
        await app.mailer.send(
          actionEmail({
            to: user.email,
            subject: 'Reset your password',
            greeting: `Hello ${user.displayName},`,
            lines: ['Someone asked to reset the password of your OVL For Business account.'],
            action: { label: 'Choose a new password', url: link(app, 'reset-password', token) },
            footer:
              'The link works for one hour. If it was not you, ignore this email: your password stays the same.',
          }),
        );
      }
      return reply.status(202).send(null);
    },
  );

  app.post(
    '/auth/password/reset',
    {
      config: strict,
      schema: {
        tags: ['auth'],
        security: [],
        description: 'Set a new password with a reset link. Signs out every device.',
        body: resetPasswordSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const user = await consumeToken(app, req.body.token, 'reset_password');
      await app.db
        .update(users)
        // Opening the link proves the inbox belongs to them.
        .set({
          passwordHash: await hashPassword(req.body.password),
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        })
        .where(eq(users.id, user.id));
      await revokeSessions(app, eq(sessions.userId, user.id));
      await app.mailer.send(
        actionEmail({
          to: user.email,
          subject: 'Your password was changed',
          greeting: `Hello ${user.displayName},`,
          lines: [
            'The password of your account was just reset and every device was signed out.',
            'If this was not you, contact support right away.',
          ],
        }),
      );
      return reply.status(204).send(null);
    },
  );

  if (app.config.NODE_ENV === 'development') {
    // Without SMTP, open the emails the server would have sent (links for sign-up and resets).
    app.get('/dev/outbox', { schema: { hide: true } }, async () => app.mailer.outbox);
  }
}
