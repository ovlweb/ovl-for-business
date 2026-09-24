import { can, type Permission, type Role } from '@ovl/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { sessions, users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  /** The signed-in session behind the access token (null for tokens issued before sessions existed). */
  sessionId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** preHandler: require a valid access token. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: attach the user when a token is present, otherwise continue anonymously. */
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: require a token and a permission. */
    requirePermission: (
      permission: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAccessToken: (user: { id: string; role: Role }, sessionId: string) => Promise<string>;
    resolveAccessToken: (token: string) => Promise<AuthUser>;
  }
}

/** The authenticated user of a request guarded by `app.authenticate`. */
export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export function registerAuth(app: FastifyInstance): void {
  const key = new TextEncoder().encode(app.config.JWT_SECRET);

  app.decorateRequest('user', null);

  app.decorate('signAccessToken', async (user: { id: string; role: Role }, sessionId: string) =>
    new SignJWT({ role: user.role, sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${app.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(key),
  );

  app.decorate('resolveAccessToken', async (token: string): Promise<AuthUser> => {
    let subject: string | undefined;
    let sessionId: string | null = null;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      subject = payload.sub;
      sessionId = typeof payload.sid === 'string' ? payload.sid : null;
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
    if (!subject) throw unauthorized('Invalid access token');
    // One query checks the account and, for session-bound tokens, that the session was not signed out.
    const [user] = await app.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        status: users.status,
        liveSession: sessions.id,
      })
      .from(users)
      .leftJoin(
        sessions,
        sessionId
          ? and(eq(sessions.id, sessionId), eq(sessions.userId, users.id), isNull(sessions.revokedAt))
          : sql`false`,
      )
      .where(eq(users.id, subject));
    if (!user) throw unauthorized('Account no longer exists');
    if (user.status !== 'active') throw forbidden('This account is suspended');
    if (sessionId && !user.liveSession) throw unauthorized('This session was signed out');
    const { status: _status, liveSession: _live, ...authUser } = user;
    return { ...authUser, sessionId };
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    req.user = await app.resolveAccessToken(token);
  });

  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    const token = bearer(req);
    if (token) req.user = await app.resolveAccessToken(token);
  });

  app.decorate('requirePermission', (permission: Permission) => async (req: FastifyRequest) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    req.user = await app.resolveAccessToken(token);
    if (!can(req.user.role, permission)) throw forbidden();
  });
}
