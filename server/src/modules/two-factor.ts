import {
  disableTwoFactorSchema,
  PLATFORM_NAME,
  recoveryCodesSchema,
  twoFactorCodeSchema,
  twoFactorSetupSchema,
  twoFactorStatusSchema,
} from '@ovl/shared';
import { and, count, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from '../db/client';
import { recoveryCodes, users } from '../db/schema';
import { sha256, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  otpauthUrl,
  sealSecret,
  verifyTotp,
} from '../lib/totp';
import { currentUser } from '../plugins/auth';

type UserRow = typeof users.$inferSelect;

export const twoFactorRequired = () =>
  new HttpError(401, 'two_factor_required', 'Enter the code from your authenticator app');
export const invalidTwoFactorCode = () =>
  new HttpError(
    401,
    'invalid_two_factor_code',
    'That code is not valid. Try the latest one, or a recovery code.',
  );

/**
 * Check an authenticator code (never the same one twice) or a one-time recovery code.
 * Both are consumed atomically, so parallel requests cannot reuse a code.
 */
export async function checkSecondFactor(app: FastifyInstance, user: UserRow, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  const step = verifyTotp(openSecret(user.totpSecret, app.config.JWT_SECRET), code);
  if (step !== null) {
    const [accepted] = await app.db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id });
    return !!accepted;
  }
  const [used] = await app.db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, user.id),
        eq(recoveryCodes.codeHash, sha256(normalizeRecoveryCode(code))),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return !!used;
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .insert(recoveryCodes)
    .values(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })));
  return codes;
}

async function loadUser(db: Db, id: string): Promise<UserRow> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw notFound('Account');
  return user;
}

export async function twoFactorRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['me'];
  const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.get(
    '/me/2fa',
    { preHandler: app.authenticate, schema: { tags, response: { 200: twoFactorStatusSchema } } },
    async (req) => {
      const user = await loadUser(app.db, currentUser(req).id);
      const [left] = await app.db
        .select({ n: count() })
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)));
      return {
        enabled: user.totpEnabledAt !== null,
        enabledAt: user.totpEnabledAt ? iso(user.totpEnabledAt) : null,
        recoveryCodesLeft: user.totpEnabledAt ? (left?.n ?? 0) : 0,
      };
    },
  );

  app.post(
    '/me/2fa/setup',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Start enabling two-factor authentication: scan the QR code, then confirm with a code.',
        response: { 200: twoFactorSetupSchema },
      },
    },
    async (req) => {
      const user = await loadUser(app.db, currentUser(req).id);
      if (user.totpEnabledAt) throw conflict('Two-factor authentication is already on');
      const secret = generateTotpSecret();
      await app.db
        .update(users)
        .set({ totpPendingSecret: sealSecret(secret, app.config.JWT_SECRET) })
        .where(eq(users.id, user.id));
      const url = otpauthUrl(secret, user.username, PLATFORM_NAME);
      return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
    },
  );

  app.post(
    '/me/2fa/enable',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: { tags, body: twoFactorCodeSchema, response: { 200: recoveryCodesSchema } },
    },
    async (req) => {
      const user = await loadUser(app.db, currentUser(req).id);
      if (user.totpEnabledAt) throw conflict('Two-factor authentication is already on');
      if (!user.totpPendingSecret) throw badRequest('Start the setup first');
      const secret = openSecret(user.totpPendingSecret, app.config.JWT_SECRET);
      const step = verifyTotp(secret, req.body.code);
      if (step === null)
        throw badRequest('That code does not match. Check the time on your phone and try again.');
      const codes = await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            totpSecret: user.totpPendingSecret,
            totpPendingSecret: null,
            totpEnabledAt: new Date(),
            totpLastStep: step,
          })
          .where(eq(users.id, user.id));
        return replaceRecoveryCodes(tx, user.id);
      });
      return { recoveryCodes: codes };
    },
  );

  app.post(
    '/me/2fa/recovery-codes',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: {
        tags,
        description: 'Replace the recovery codes (the old ones stop working).',
        body: twoFactorCodeSchema,
        response: { 200: recoveryCodesSchema },
      },
    },
    async (req) => {
      const user = await loadUser(app.db, currentUser(req).id);
      if (!user.totpEnabledAt) throw badRequest('Two-factor authentication is off');
      if (!(await checkSecondFactor(app, user, req.body.code))) throw invalidTwoFactorCode();
      return { recoveryCodes: await replaceRecoveryCodes(app.db, user.id) };
    },
  );

  app.post(
    '/me/2fa/disable',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: { tags, body: disableTwoFactorSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = await loadUser(app.db, currentUser(req).id);
      if (!user.totpEnabledAt) throw badRequest('Two-factor authentication is off');
      if (!(await verifyPassword(req.body.password, user.passwordHash)))
        throw badRequest('The password is wrong');
      if (!(await checkSecondFactor(app, user, req.body.code))) throw invalidTwoFactorCode();
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null })
          .where(eq(users.id, user.id));
        await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      });
      return reply.status(204).send(null);
    },
  );
}
