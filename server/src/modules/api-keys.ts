import { apiKeySchema, createApiKeySchema, createdApiKeySchema, type ApiKey } from '@ovl/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apiKeys } from '../db/schema';
import { conflict } from '../lib/errors';
import { generateApiKey } from '../lib/crypto';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';

type ApiKeyRow = typeof apiKeys.$inferSelect;

export function toApiKeyDto(k: ApiKeyRow, owner: { id: string; username: string }): ApiKey {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes as ApiKey['scopes'],
    owner,
    createdAt: iso(k.createdAt),
    lastUsedAt: isoOrNull(k.lastUsedAt),
    revokedAt: isoOrNull(k.revokedAt),
  };
}

/** Developer keys for services that integrate with the public registry / stock API. */
export async function apiKeyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['developer api keys'];
  app.addHook('preHandler', app.authenticate);

  app.get('/api-keys', { schema: { tags, response: { 200: z.array(apiKeySchema) } } }, async (req) => {
    const me = currentUser(req);
    const rows = await app.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, me.id))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map((k) => toApiKeyDto(k, me));
  });

  app.post(
    '/api-keys',
    { schema: { tags, body: createApiKeySchema, response: { 201: createdApiKeySchema } } },
    async (req, reply) => {
      const me = currentUser(req);
      const active = await app.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, me.id), isNull(apiKeys.revokedAt)));
      if (active.length >= 10) throw conflict('You can have at most 10 active API keys');
      const { key, prefix, hash } = generateApiKey();
      const [row] = await app.db
        .insert(apiKeys)
        .values({ userId: me.id, name: req.body.name, prefix, keyHash: hash, scopes: req.body.scopes })
        .returning();
      return reply.status(201).send({ ...toApiKeyDto(row!, me), key });
    },
  );

  app.delete(
    '/api-keys/:id',
    { schema: { tags, params: z.object({ id: z.uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      await app.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, req.params.id),
            eq(apiKeys.userId, currentUser(req).id),
            isNull(apiKeys.revokedAt),
          ),
        );
      return reply.status(204).send(null);
    },
  );
}
