import {
  addPasskeySchema,
  authResultSchema,
  passkeyLoginSchema,
  passkeyOptionsSchema,
  passkeySchema,
  PLATFORM_NAME,
} from '@ovl/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import { passkeys, users, webauthnChallenges } from '../db/schema';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { issueTokens } from './auth';
import { clientContext } from './sessions';

const CHALLENGE_TTL_MS = 5 * 60_000;

/** Where passkeys work: the relying-party ID and the origins of the web client and admin panel. */
export function webauthnSettings(config: Config) {
  const rpID = config.WEBAUTHN_RP_ID ?? new URL(config.PUBLIC_WEB_URL).hostname;
  const origins = config.WEBAUTHN_ORIGINS
    ? config.WEBAUTHN_ORIGINS.split(',').map((o) => o.trim())
    : [new URL(config.PUBLIC_WEB_URL).origin, new URL(config.PUBLIC_ADMIN_URL).origin];
  return { rpID, origins };
}

const passkeyFailed = () =>
  new HttpError(401, 'passkey_failed', 'That passkey could not be verified. Try again or use your password.');

/** UUID string → its 16 bytes (the WebAuthn user handle). */
const uuidBytes = (id: string) => Uint8Array.from(Buffer.from(id.replace(/-/g, ''), 'hex'));

export async function passkeyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { rpID, origins } = webauthnSettings(app.config);
  const strict = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  const saveChallenge = async (purpose: 'register' | 'login', challenge: string, userId: string | null) => {
    // Housekeeping: expired challenges are never useful.
    await app.db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
    const [row] = await app.db
      .insert(webauthnChallenges)
      .values({ purpose, challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
      .returning({ id: webauthnChallenges.id });
    return row!.id;
  };

  /** Use a challenge up: it works once, for its purpose (and user), before it expires. */
  const takeChallenge = async (id: string, purpose: 'register' | 'login', userId: string | null) => {
    const [row] = await app.db
      .delete(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.id, id),
          eq(webauthnChallenges.purpose, purpose),
          gt(webauthnChallenges.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row || (userId && row.userId !== userId))
      throw badRequest('This passkey request expired. Try again.');
    return row.challenge;
  };

  app.get(
    '/me/passkeys',
    { preHandler: app.authenticate, schema: { tags: ['me'], response: { 200: z.array(passkeySchema) } } },
    async (req) => {
      const rows = await app.db
        .select()
        .from(passkeys)
        .where(eq(passkeys.userId, currentUser(req).id))
        .orderBy(desc(passkeys.createdAt));
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        backedUp: p.backedUp,
        createdAt: iso(p.createdAt),
        lastUsedAt: isoOrNull(p.lastUsedAt),
      }));
    },
  );

  app.post(
    '/me/passkeys/options',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: {
        tags: ['me'],
        description: 'Start adding a passkey: pass `options` to navigator.credentials.create().',
        response: { 200: passkeyOptionsSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const existing = await app.db
        .select({ id: passkeys.id, transports: passkeys.transports })
        .from(passkeys)
        .where(eq(passkeys.userId, me.id));
      const options = await generateRegistrationOptions({
        rpName: PLATFORM_NAME,
        rpID,
        userName: me.username,
        userDisplayName: me.displayName,
        userID: uuidBytes(me.id),
        attestationType: 'none',
        excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      return {
        challengeId: await saveChallenge('register', options.challenge, me.id),
        options: options as unknown as Record<string, unknown>,
      };
    },
  );

  app.post(
    '/me/passkeys',
    {
      preHandler: app.authenticate,
      config: strict,
      schema: { tags: ['me'], body: addPasskeySchema, response: { 201: passkeySchema } },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const expectedChallenge = await takeChallenge(req.body.challengeId, 'register', me.id);
      const verification = await verifyRegistrationResponse({
        response: req.body.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      }).catch(() => null);
      if (!verification?.verified) throw badRequest('The passkey could not be verified');
      const { credential, credentialBackedUp } = verification.registrationInfo;
      const [row] = await app.db
        .insert(passkeys)
        .values({
          id: credential.id,
          userId: me.id,
          name: req.body.name,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: credential.transports ?? [],
          backedUp: credentialBackedUp,
        })
        .returning();
      return reply.status(201).send({
        id: row!.id,
        name: row!.name,
        backedUp: row!.backedUp,
        createdAt: iso(row!.createdAt),
        lastUsedAt: null,
      });
    },
  );

  app.delete(
    '/me/passkeys/:id',
    {
      preHandler: app.authenticate,
      schema: { tags: ['me'], params: z.object({ id: z.string().max(512) }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const [gone] = await app.db
        .delete(passkeys)
        .where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, currentUser(req).id)))
        .returning({ id: passkeys.id });
      if (!gone) throw notFound('Passkey');
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/auth/passkey/options',
    {
      config: strict,
      schema: {
        tags: ['auth'],
        security: [],
        description: 'Start signing in with a passkey: pass `options` to navigator.credentials.get().',
        response: { 200: passkeyOptionsSchema },
      },
    },
    async () => {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
      return {
        challengeId: await saveChallenge('login', options.challenge, null),
        options: options as unknown as Record<string, unknown>,
      };
    },
  );

  app.post(
    '/auth/passkey',
    {
      config: strict,
      schema: {
        tags: ['auth'],
        security: [],
        description:
          'Sign in with a passkey. It proves both possession and the person (fingerprint, face or PIN), ' +
          'so no authenticator code is asked.',
        body: passkeyLoginSchema,
        response: { 200: authResultSchema },
      },
    },
    async (req) => {
      const expectedChallenge = await takeChallenge(req.body.challengeId, 'login', null);
      const response = req.body.response as unknown as AuthenticationResponseJSON;
      const [key] = await app.db
        .select()
        .from(passkeys)
        .where(eq(passkeys.id, String(response.id ?? '')));
      if (!key) throw passkeyFailed();
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: Uint8Array.from(Buffer.from(key.publicKey, 'base64url')),
          counter: key.counter,
          transports: key.transports,
        },
      }).catch(() => null);
      if (!verification?.verified) throw passkeyFailed();
      const [user] = await app.db.select().from(users).where(eq(users.id, key.userId));
      if (!user) throw passkeyFailed();
      if (user.status !== 'active') throw new HttpError(403, 'forbidden', 'This account is suspended');
      await app.db
        .update(passkeys)
        .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
        .where(eq(passkeys.id, key.id));
      return issueTokens(app, user, { ...clientContext(req), method: 'passkey' });
    },
  );
}
