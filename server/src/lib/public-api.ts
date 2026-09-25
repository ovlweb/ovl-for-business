import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { apiKeys } from '../db/schema';
import { sha256 } from './crypto';
import { forbidden, unauthorized } from './errors';
import { text } from './i18n';

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Rate limits for endpoints that third-party services may call:
 * anonymous callers get PUBLIC_RATE_LIMIT per minute per IP, callers with a developer
 * API key (X-API-Key) or a signed-in user get API_KEY_RATE_LIMIT.
 */
export function publicRouteConfig(app: FastifyInstance) {
  return {
    rateLimit: {
      timeWindow: '1 minute',
      max: (req: FastifyRequest) =>
        header(req, 'x-api-key') || header(req, 'authorization')
          ? app.config.API_KEY_RATE_LIMIT
          : app.config.PUBLIC_RATE_LIMIT,
      keyGenerator: (req: FastifyRequest) => {
        const key = header(req, 'x-api-key') ?? header(req, 'authorization');
        return key ? `k:${sha256(key)}` : `ip:${req.ip}`;
      },
    },
  };
}

/** preHandler: validate an optional X-API-Key and its scope; signed-in users pass through. */
export function apiKeyGuard(app: FastifyInstance, scope: string) {
  return async (req: FastifyRequest) => {
    const key = header(req, 'x-api-key');
    if (!key) return app.optionalAuth(req, undefined as never);
    const [row] = await app.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, sha256(key)));
    if (!row || row.revokedAt) throw unauthorized('Invalid API key');
    if (!row.scopes.includes(scope)) throw forbidden(text`This API key lacks the ${scope} scope`);
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await app.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    }
  };
}
