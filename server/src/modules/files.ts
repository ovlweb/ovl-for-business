import { can, fileSchema, UPLOAD_TYPES, type FileInfo } from '@ovl/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/client';
import { applications, chats, files } from '../db/schema';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import { openLink, signLink } from '../lib/signed-links';
import { currentUser, type AuthUser } from '../plugins/auth';
import { chatAccess } from './chats/service';

export type FileRow = typeof files.$inferSelect;

/** Signed download links stay valid this long (they are handed out with every listing). */
const LINK_TTL_MS = 60 * 60_000;
const INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
]);

export type FileScope = 'application' | 'chat' | 'identity';

export function fileDtos(app: FastifyInstance, rows: FileRow[]): FileInfo[] {
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    contentType: f.contentType,
    size: f.size,
    url: `/api/v1/files/${f.id}?sig=${signLink({ f: f.id }, app.config.JWT_SECRET, LINK_TTL_MS)}`,
    createdAt: iso(f.createdAt),
  }));
}

export async function filesOf(db: Db, scope: FileScope, scopeIds: string[]): Promise<FileRow[]> {
  if (!scopeIds.length) return [];
  return db
    .select()
    .from(files)
    .where(and(eq(files.scope, scope), inArray(files.scopeId, scopeIds)))
    .orderBy(files.createdAt);
}

/**
 * Attach the uploader's own, not yet attached files to something. Anything else in `ids` is an
 * error, so a file cannot be moved from one application or chat to another.
 */
export async function attachFiles(db: Db, ownerId: string, ids: string[], scope: FileScope, scopeId: string) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const attached = await db
    .update(files)
    .set({ scope, scopeId })
    .where(and(inArray(files.id, unique), eq(files.ownerId, ownerId), isNull(files.scope)))
    .returning({ id: files.id });
  if (attached.length !== unique.length) throw badRequest('Attach files you uploaded yourself, once each');
}

/** Who may read a file: its uploader, and whoever may see what it is attached to. */
async function canRead(db: Db, file: FileRow, user: AuthUser): Promise<boolean> {
  if (file.ownerId === user.id) return true;
  if (file.scope === 'application' && file.scopeId) {
    if (can(user.role, 'applications.view_all')) return true;
    const [row] = await db
      .select({ applicantId: applications.applicantId })
      .from(applications)
      .where(eq(applications.id, file.scopeId));
    return row?.applicantId === user.id;
  }
  if (file.scope === 'identity') return can(user.role, 'identity.review');
  if (file.scope === 'chat' && file.scopeId) {
    const [chat] = await db.select().from(chats).where(eq(chats.id, file.scopeId));
    return !!chat && (await chatAccess(db, chat, user)).canRead;
  }
  return false;
}

export async function fileRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['files'];
  const maxBytes = app.config.MAX_UPLOAD_MB * 1024 * 1024;

  // Uploads are the raw file bytes with the file's own Content-Type.
  app.addContentTypeParser(
    [...UPLOAD_TYPES],
    { parseAs: 'buffer', bodyLimit: maxBytes },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/files',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      bodyLimit: maxBytes,
      schema: {
        tags,
        description:
          `Upload a file: send its bytes as the body with its Content-Type (${UPLOAD_TYPES.length} types: ` +
          `images, PDF, text, office documents, zip; up to MAX_UPLOAD_MB). It stays private until attached.`,
        querystring: z.object({ name: z.string().trim().min(1).max(255) }),
        response: { 201: fileSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(UPLOAD_TYPES as readonly string[]).includes(type))
        throw new HttpError(415, 'unsupported_type', 'This kind of file cannot be uploaded');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The file is empty');
      const id = randomUUID();
      const storageKey = `${new Date().toISOString().slice(0, 7)}/${id}`;
      await app.storage.put(storageKey, body, type);
      const [row] = await app.db
        .insert(files)
        .values({
          id,
          ownerId: me.id,
          storageKey,
          name: req.query.name.replace(/[\\/\r\n"]/g, '_'),
          contentType: type,
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        })
        .returning();
      return reply.status(201).send(fileDtos(app, [row!])[0]!);
    },
  );

  app.get(
    '/files/:id',
    {
      // A signed link (from any file listing) or a normal access token.
      preHandler: async (req, reply) => {
        if (!(req.query as { sig?: string }).sig) await app.authenticate(req, reply);
      },
      schema: {
        tags,
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ sig: z.string().max(1024).optional(), download: z.literal('1').optional() }),
      },
    },
    async (req, reply) => {
      const [file] = await app.db.select().from(files).where(eq(files.id, req.params.id));
      if (!file) throw notFound('File');
      if (req.query.sig) {
        const payload = openLink<{ f: string }>(req.query.sig, app.config.JWT_SECRET);
        if (payload?.f !== file.id) throw new HttpError(401, 'invalid_link', 'This file link has expired');
      } else if (!(await canRead(app.db, file, currentUser(req)))) {
        throw notFound('File');
      }
      const data = await app.storage.get(file.storageKey);
      if (!data) throw notFound('File');
      const disposition = INLINE.has(file.contentType) && !req.query.download ? 'inline' : 'attachment';
      return reply
        .header('content-type', file.contentType)
        .header('content-length', data.length)
        .header('content-disposition', `${disposition}; filename="${encodeURIComponent(file.name)}"`)
        .header('cache-control', 'private, max-age=3600')
        .header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
        .send(data);
    },
  );

  app.delete(
    '/files/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Delete one of your uploads that is not attached to anything yet.',
        params: z.object({ id: z.uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const [file] = await app.db.select().from(files).where(eq(files.id, req.params.id));
      if (!file || file.ownerId !== currentUser(req).id) throw notFound('File');
      if (file.scope) throw forbidden('Attached files stay with what they are attached to');
      await app.db.delete(files).where(eq(files.id, file.id));
      await app.storage.delete(file.storageKey);
      return reply.status(204).send(null);
    },
  );
}
