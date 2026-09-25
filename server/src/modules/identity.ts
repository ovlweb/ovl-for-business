import {
  IDENTITY_STATUSES,
  identityCheckSchema,
  identityDecisionSchema,
  identitySubmitSchema,
  type IdentityCheck,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHmac, hkdfSync } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/client';
import { identityChecks, organizations, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actionEmail } from '../lib/mailer';
import { iso, isoOrNull, summaryColumns, toUserSummary } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { attachFiles, fileDtos, filesOf } from './files';
import { queueNotification } from '../lib/notify';
import { text, userLocale, type Text } from '../lib/i18n';

type CheckRow = typeof identityChecks.$inferSelect;

const MIN_AGE_YEARS = 16;

/** Keyed hash of a normalized document number (never stored in clear). */
function documentHash(number: string, serverSecret: string): string {
  const key = Buffer.from(hkdfSync('sha256', serverSecret, 'ovl-for-business', 'identity-documents-v1', 32));
  return createHmac('sha256', key)
    .update(number.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');
}

const reviewer = alias(users, 'reviewer');

async function checkDtos(app: FastifyInstance, rows: CheckRow[]): Promise<IdentityCheck[]> {
  if (!rows.length) return [];
  const db = app.db;
  const reviewerIds = [...new Set(rows.flatMap((r) => (r.reviewedBy ? [r.reviewedBy] : [])))];
  const [people, reviewers, attached, duplicates] = await Promise.all([
    db
      .select(summaryColumns(users))
      .from(users)
      .where(
        inArray(
          users.id,
          rows.map((r) => r.userId),
        ),
      ),
    reviewerIds.length
      ? db
          .select({ id: reviewer.id, username: reviewer.username, displayName: reviewer.displayName })
          .from(reviewer)
          .where(inArray(reviewer.id, reviewerIds))
      : Promise.resolve([]),
    filesOf(
      db,
      'identity',
      rows.map((r) => r.id),
    ),
    // The same document on another account that is (or was) verified.
    db
      .select({ hash: identityChecks.documentHash, userId: identityChecks.userId })
      .from(identityChecks)
      .where(
        and(
          inArray(
            identityChecks.documentHash,
            rows.map((r) => r.documentHash),
          ),
          or(eq(identityChecks.status, 'approved'), eq(identityChecks.status, 'revoked')),
        ),
      ),
  ]);
  const personBy = new Map(people.map((p) => [p.id, toUserSummary(p)]));
  const reviewerBy = new Map(reviewers.map((r) => [r.id, r]));
  return rows.map((r) => ({
    id: r.id,
    user: personBy.get(r.userId)!,
    status: r.status,
    legalName: r.legalName,
    dateOfBirth: r.dateOfBirth,
    country: r.country,
    documentType: r.documentType as IdentityCheck['documentType'],
    documentLast4: r.documentLast4,
    files: fileDtos(
      app,
      attached.filter((f) => f.scopeId === r.id),
    ),
    duplicate: duplicates.some((d) => d.hash === r.documentHash && d.userId !== r.userId),
    rejectionReason: r.rejectionReason,
    reviewedBy: r.reviewedBy ? (reviewerBy.get(r.reviewedBy) ?? null) : null,
    createdAt: iso(r.createdAt),
    reviewedAt: isoOrNull(r.reviewedAt),
  }));
}

/** Verified business follows the owner's identity. */
async function syncOwnedOrganizations(db: Db, userId: string, verified: boolean) {
  await db
    .update(organizations)
    .set({ verifiedAt: verified ? new Date() : null })
    .where(
      and(eq(organizations.ownerId, userId), verified ? undefined : isNotNull(organizations.verifiedAt)),
    );
}

export async function identityRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const load = async (id: string) => {
    const [row] = await app.db.select().from(identityChecks).where(eq(identityChecks.id, id));
    if (!row) throw notFound('Identity check');
    return row;
  };
  const tell = async (userId: string, status: string, subject: Text, lines: Text[]) => {
    app.hub.sendToUsers([userId], { type: 'identity.updated', status });
    await queueNotification(app.db, [userId], {
      type: 'identity',
      title: subject,
      body: lines[0] ?? '',
      link: '/settings',
    });
    const [user] = await app.db.select().from(users).where(eq(users.id, userId));
    if (user) {
      await app.mailer
        .send(
          actionEmail({
            to: user.email,
            locale: userLocale(user.preferences),
            subject,
            greeting: text`Hello ${user.displayName},`,
            lines,
          }),
        )
        .catch((err) => app.log.error({ err }, 'identity email failed'));
    }
  };

  app.get(
    '/me/identity',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        description: 'Your latest identity check, or null.',
        response: { 200: identityCheckSchema.nullable() },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select()
        .from(identityChecks)
        .where(eq(identityChecks.userId, currentUser(req).id))
        .orderBy(desc(identityChecks.createdAt))
        .limit(1);
      return row ? (await checkDtos(app, [row]))[0]! : null;
    },
  );

  app.post(
    '/me/identity',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['me'],
        description:
          'Ask for an identity check: your legal details and a photo of an identity document (upload it with ' +
          'POST /files first). Staff check it by hand; company owners need it before approval.',
        body: identitySubmitSchema,
        response: { 201: identityCheckSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const input = req.body;
      const born = new Date(`${input.dateOfBirth}T00:00:00Z`);
      const adult = new Date(born);
      adult.setUTCFullYear(born.getUTCFullYear() + MIN_AGE_YEARS);
      if (Number.isNaN(born.getTime()) || adult > new Date())
        throw badRequest(text`You must be at least ${MIN_AGE_YEARS} years old`);
      const id = await app.db.transaction(async (tx) => {
        const [open] = await tx
          .select({ status: identityChecks.status })
          .from(identityChecks)
          .where(
            and(
              eq(identityChecks.userId, me.id),
              or(eq(identityChecks.status, 'pending'), eq(identityChecks.status, 'approved')),
            ),
          );
        if (open)
          throw conflict(
            open.status === 'approved' ? 'Your identity is already verified' : 'A check is in progress',
          );
        const number = input.documentNumber.replace(/\s/g, '');
        const [row] = await tx
          .insert(identityChecks)
          .values({
            userId: me.id,
            legalName: input.legalName,
            dateOfBirth: input.dateOfBirth,
            country: input.country,
            documentType: input.documentType,
            documentLast4: number.slice(-4).toUpperCase(),
            documentHash: documentHash(number, app.config.JWT_SECRET),
          })
          .returning({ id: identityChecks.id });
        await attachFiles(
          tx,
          me.id,
          [input.documentFileId, ...(input.selfieFileId ? [input.selfieFileId] : [])],
          'identity',
          row!.id,
        );
        return row!.id;
      });
      return reply.status(201).send((await checkDtos(app, [await load(id)]))[0]!);
    },
  );

  // ----- Staff ---------------------------------------------------------------------------

  app.get(
    '/admin/identity-checks',
    {
      preHandler: app.requirePermission('identity.review'),
      schema: {
        tags: ['admin'],
        querystring: z.object({ status: z.enum(IDENTITY_STATUSES).optional() }),
        response: { 200: z.array(identityCheckSchema) },
      },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(identityChecks)
        .where(req.query.status ? eq(identityChecks.status, req.query.status) : undefined)
        .orderBy(req.query.status === 'pending' ? identityChecks.createdAt : desc(identityChecks.createdAt))
        .limit(200);
      return checkDtos(app, rows);
    },
  );

  const decide = (action: 'approve' | 'reject' | 'revoke') =>
    app.post(
      `/admin/identity-checks/:id/${action}`,
      {
        preHandler: app.requirePermission('identity.review'),
        schema: {
          tags: ['admin'],
          params: z.object({ id: z.uuid() }),
          body: action === 'approve' ? z.object({}).optional() : identityDecisionSchema,
          response: { 200: identityCheckSchema },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const reason = (req.body as { reason?: string } | undefined)?.reason ?? null;
        const row = await app.db.transaction(async (tx) => {
          const [check] = await tx
            .select()
            .from(identityChecks)
            .where(eq(identityChecks.id, req.params.id))
            .for('update');
          if (!check) throw notFound('Identity check');
          const from = action === 'revoke' ? 'approved' : 'pending';
          if (check.status !== from) throw conflict(text`This check is ${check.status}`);
          if (check.userId === me.id) throw conflict('Another reviewer must check your own identity');
          const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked';
          const [updated] = await tx
            .update(identityChecks)
            .set({ status, rejectionReason: reason, reviewedBy: me.id, reviewedAt: new Date() })
            .where(eq(identityChecks.id, check.id))
            .returning();
          if (action !== 'reject') {
            await tx
              .update(users)
              .set({ identityVerifiedAt: action === 'approve' ? new Date() : null })
              .where(eq(users.id, check.userId));
            await syncOwnedOrganizations(tx, check.userId, action === 'approve');
          }
          await audit(tx, {
            actorId: me.id,
            action: `identity.${action}`,
            targetType: 'user',
            targetId: check.userId,
            data: reason ? { reason } : undefined,
            ip: req.ip,
          });
          return updated!;
        });
        const messages = {
          approve: ['Your identity is verified. Companies you own now show the verified business badge.'],
          reject: [
            text`Your identity check was not accepted: ${reason}`,
            'You can send a new one from Settings.',
          ],
          revoke: [
            text`Your verified status was removed: ${reason}`,
            'Contact support if you think this is a mistake.',
          ],
        }[action];
        await tell(row.userId, row.status, 'Your identity check', messages);
        return (await checkDtos(app, [row]))[0]!;
      },
    );
  decide('approve');
  decide('reject');
  decide('revoke');
}

/** Count for the admin dashboard and navigation. */
export async function pendingIdentityChecks(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(identityChecks)
    .where(eq(identityChecks.status, 'pending'));
  return row?.n ?? 0;
}
