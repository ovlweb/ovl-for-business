import { authResultSchema, can } from '@ovl/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { users, webauthnChallenges } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, HttpError } from '../lib/errors';
import { issueTokens } from './auth';
import { clientContext } from './sessions';

/**
 * Single sign-on for the admin panel with OpenID Connect (authorization code + PKCE). The
 * identity provider proves the email address; the account must already exist and be staff.
 */
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const STATE_TTL_MS = 10 * 60_000;
const b64url = (b: Buffer) => b.toString('base64url');

export async function ssoRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_LABEL } = app.config;
  const enabled = !!(OIDC_ISSUER && OIDC_CLIENT_ID);
  const redirectUri = `${app.config.PUBLIC_ADMIN_URL.replace(/\/+$/, '')}/`;

  let discovery: { doc: Discovery; jwks: JWTVerifyGetKey; at: number } | null = null;
  const provider = async () => {
    if (discovery && Date.now() - discovery.at < 3_600_000) return discovery;
    const url = `${OIDC_ISSUER!.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(502, 'sso_unavailable', 'The sign-in provider is not reachable');
    const doc = (await res.json()) as Discovery;
    discovery = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
    return discovery;
  };
  const failed = (message = 'Single sign-on did not work. Try again.') =>
    new HttpError(401, 'sso_failed', message);

  app.get(
    '/auth/sso',
    {
      schema: {
        tags: ['auth'],
        security: [],
        description: 'Whether the admin panel offers single sign-on (OpenID Connect).',
        response: { 200: z.object({ enabled: z.boolean(), label: z.string() }) },
      },
    },
    async () => ({ enabled, label: OIDC_LABEL }),
  );

  app.post(
    '/auth/sso/start',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        security: [],
        description: "Get the provider's sign-in URL; it comes back to the admin panel with ?code&state.",
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async () => {
      if (!enabled) throw badRequest('Single sign-on is not configured');
      const { doc } = await provider();
      const verifier = b64url(randomBytes(32));
      const nonce = b64url(randomBytes(16));
      await app.db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
      const [row] = await app.db
        .insert(webauthnChallenges)
        .values({
          purpose: 'sso',
          challenge: `${nonce}.${verifier}`,
          expiresAt: new Date(Date.now() + STATE_TTL_MS),
        })
        .returning({ id: webauthnChallenges.id });
      const url = new URL(doc.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: OIDC_CLIENT_ID!,
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: row!.id,
        nonce,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      }).toString();
      return { url: url.toString() };
    },
  );

  app.post(
    '/auth/sso/callback',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        security: [],
        description: 'Finish single sign-on with the code and state the provider sent back.',
        body: z.object({ code: z.string().min(1).max(4096), state: z.uuid() }),
        response: { 200: authResultSchema },
      },
    },
    async (req) => {
      if (!enabled) throw badRequest('Single sign-on is not configured');
      const [pending] = await app.db
        .delete(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.id, req.body.state),
            eq(webauthnChallenges.purpose, 'sso'),
            gt(webauthnChallenges.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!pending) throw failed('This sign-in expired. Start again.');
      const [nonce, verifier] = pending.challenge.split('.');
      const { doc, jwks } = await provider();

      const res = await fetch(doc.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.body.code,
          redirect_uri: redirectUri,
          client_id: OIDC_CLIENT_ID!,
          ...(OIDC_CLIENT_SECRET ? { client_secret: OIDC_CLIENT_SECRET } : {}),
          code_verifier: verifier!,
        }),
      });
      if (!res.ok) throw failed();
      const tokens = (await res.json()) as { id_token?: string };
      if (!tokens.id_token) throw failed();
      let claims: { email?: unknown; email_verified?: unknown; nonce?: unknown };
      try {
        ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, {
          issuer: doc.issuer,
          audience: OIDC_CLIENT_ID!,
        }));
      } catch {
        throw failed();
      }
      if (claims.nonce !== nonce) throw failed();
      if (typeof claims.email !== 'string' || claims.email_verified === false)
        throw failed('The provider did not confirm an email address');

      const [user] = await app.db.select().from(users).where(eq(users.email, claims.email.toLowerCase()));
      if (!user || user.status !== 'active' || !can(user.role, 'admin.panel'))
        throw new HttpError(403, 'sso_no_account', `No staff account uses ${claims.email}`);
      await audit(app.db, {
        actorId: user.id,
        action: 'auth.sso',
        targetType: 'user',
        targetId: user.id,
        data: { issuer: doc.issuer },
        ip: req.ip,
      });
      return issueTokens(app, user, { ...clientContext(req), method: 'sso' });
    },
  );
}
