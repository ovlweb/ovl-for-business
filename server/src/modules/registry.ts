import {
  LICENSE_TYPE_LABELS,
  myLicenceSchema,
  pageOf,
  RENEWAL_GRACE_DAYS,
  registryEntrySchema,
  registrySearchQuery,
  type LicenseType,
  type RegistryEntry,
} from '@ovl/shared';
import { and, count, desc, eq, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import {
  applications,
  organizationMembers,
  organizations,
  registryCounters,
  registryEntries,
  users,
  virtualCurrencies,
} from '../db/schema';
import { notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { actionEmail } from '../lib/mailer';
import { certificatePdf, pdfDate } from '../lib/pdf';
import { apiKeyGuard, publicRouteConfig } from '../lib/public-api';
import { emitEvent } from '../lib/webhooks';
import { currentUser } from '../plugins/auth';
import { queueNotification } from '../lib/notify';

type RegistryKind = (typeof registryEntries.$inferInsert)['kind'];

const PREFIX: Record<RegistryKind, string> = { organization: 'ORG', license: 'LIC', virtual_country: 'VC' };

async function nextRegistryNumber(db: Db, kind: RegistryKind): Promise<string> {
  const [row] = await db
    .insert(registryCounters)
    .values({ kind, value: 1 })
    .onConflictDoUpdate({ target: registryCounters.kind, set: { value: sql`${registryCounters.value} + 1` } })
    .returning();
  return `OVL-${PREFIX[kind]}-${String(row!.value).padStart(6, '0')}`;
}

export interface IssueRegistryEntry {
  kind: RegistryKind;
  licenseType?: LicenseType | null;
  title: string;
  description: string;
  website?: string | null;
  holder: { type: 'user' | 'organization'; id: string };
  applicationId?: string;
  data?: Record<string, unknown>;
  expiresAt?: Date | null;
}

/** When a licence issued (or renewed) at `from` expires, or null when licences do not expire. */
export function licenceExpiry(config: Config, from = new Date()): Date | null {
  if (!config.LICENSE_TERM_MONTHS) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + config.LICENSE_TERM_MONTHS);
  return d;
}

/** Roll an approved entry out into the public registry. */
export async function issueRegistryEntry(db: Db, input: IssueRegistryEntry) {
  const number = await nextRegistryNumber(db, input.kind);
  const [entry] = await db
    .insert(registryEntries)
    .values({
      number,
      kind: input.kind,
      licenseType: input.licenseType ?? null,
      title: input.title,
      description: input.description,
      website: input.website || null,
      holderUserId: input.holder.type === 'user' ? input.holder.id : null,
      holderOrganizationId: input.holder.type === 'organization' ? input.holder.id : null,
      applicationId: input.applicationId ?? null,
      data: input.data ?? {},
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  await emitRegistryEvent(db, 'registry.created', entry!.id);
  return entry!;
}

/** Tell webhook subscribers about a registry entry (call inside the transaction that changed it). */
export async function emitRegistryEvent(db: Db, type: 'registry.created' | 'registry.updated', id: string) {
  const entry = await getRegistryEntry(db, id);
  if (entry) await emitEvent(db, type, entry as unknown as Record<string, unknown>);
}

const registrySelect = {
  entry: registryEntries,
  userName: users.displayName,
  username: users.username,
  orgName: organizations.name,
  orgSlug: organizations.slug,
  orgVerifiedAt: organizations.verifiedAt,
  orgStatus: organizations.status,
  currencyCode: virtualCurrencies.code,
};

type RegistryRow = {
  entry: typeof registryEntries.$inferSelect;
  userName: string | null;
  username: string | null;
  orgName: string | null;
  orgSlug: string | null;
  orgVerifiedAt: Date | null;
  orgStatus: 'active' | 'suspended' | null;
  currencyCode: string | null;
};

export function toRegistryDto(row: RegistryRow): RegistryEntry {
  const { entry } = row;
  const isOrg = !!entry.holderOrganizationId;
  return {
    id: entry.id,
    number: entry.number,
    kind: entry.kind,
    licenseType: (entry.licenseType as LicenseType | null) ?? null,
    title: entry.title,
    description: entry.description,
    website: entry.website,
    status: entry.status,
    holder: isOrg
      ? {
          type: 'organization',
          id: entry.holderOrganizationId!,
          name: row.orgName ?? '',
          handle: row.orgSlug ?? '',
          verified: row.orgVerifiedAt !== null && row.orgStatus === 'active',
        }
      : {
          type: 'user',
          id: entry.holderUserId!,
          name: row.userName ?? '',
          handle: row.username ?? '',
          verified: false,
        },
    issuedAt: iso(entry.issuedAt),
    expiresAt: isoOrNull(entry.expiresAt),
    currency: row.currencyCode ?? null,
    updatedAt: iso(entry.updatedAt),
  };
}

export function registryQuery(db: Db) {
  return db
    .select(registrySelect)
    .from(registryEntries)
    .leftJoin(users, eq(users.id, registryEntries.holderUserId))
    .leftJoin(organizations, eq(organizations.id, registryEntries.holderOrganizationId))
    .leftJoin(virtualCurrencies, eq(virtualCurrencies.registryEntryId, registryEntries.id));
}

export async function getRegistryEntry(db: Db, idOrNumber: string): Promise<RegistryEntry | null> {
  const isUuid = z.uuid().safeParse(idOrNumber).success;
  const [row] = await registryQuery(db).where(
    isUuid ? eq(registryEntries.id, idOrNumber) : eq(registryEntries.number, idOrNumber.toUpperCase()),
  );
  return row ? toRegistryDto(row) : null;
}

type EntryRow = typeof registryEntries.$inferSelect;

/** Who hears about a licence: the person, or the company's owner. */
async function holderContact(db: Db, entry: EntryRow) {
  const [row] = entry.holderUserId
    ? await db
        .select({ id: users.id, email: users.email, name: users.displayName })
        .from(users)
        .where(eq(users.id, entry.holderUserId))
    : await db
        .select({ id: users.id, email: users.email, name: users.displayName })
        .from(organizations)
        .innerJoin(users, eq(users.id, organizations.ownerId))
        .where(eq(organizations.id, entry.holderOrganizationId!));
  return row ?? null;
}

/**
 * Remind holders 30 and 7 days before a licence expires, and mark expired licences. Claimed row
 * by row with SKIP LOCKED, so several instances never send the same reminder twice.
 */
export async function runLicenceExpiry(app: FastifyInstance, now = new Date()) {
  const day = 86_400_000;
  const web = app.config.PUBLIC_WEB_URL.replace(/\/+$/, '');
  const done = { reminded: 0, expired: 0 };
  for (let i = 0; i < 500; i++) {
    const outcome = await app.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(registryEntries)
        .where(
          and(
            eq(registryEntries.status, 'active'),
            isNotNull(registryEntries.expiresAt),
            or(
              lte(registryEntries.expiresAt, now),
              and(
                lte(registryEntries.expiresAt, new Date(now.getTime() + 30 * day)),
                lt(registryEntries.reminderStage, 1),
              ),
              and(
                lte(registryEntries.expiresAt, new Date(now.getTime() + 7 * day)),
                lt(registryEntries.reminderStage, 2),
              ),
            ),
          ),
        )
        .orderBy(registryEntries.expiresAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!entry) return null;
      if (entry.expiresAt! <= now) {
        await tx
          .update(registryEntries)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(registryEntries.id, entry.id));
        await emitRegistryEvent(tx, 'registry.updated', entry.id);
        return { entry, kind: 'expired' as const };
      }
      const stage = entry.expiresAt!.getTime() - now.getTime() <= 7 * day ? 2 : 1;
      await tx.update(registryEntries).set({ reminderStage: stage }).where(eq(registryEntries.id, entry.id));
      return { entry, kind: 'reminder' as const };
    });
    if (!outcome) break;
    const { entry } = outcome;
    const person = await holderContact(app.db, entry);
    const when = pdfDate(entry.expiresAt!);
    if (outcome.kind === 'expired') done.expired++;
    else done.reminded++;
    if (!person) continue;
    await queueNotification(app.db, [person.id], {
      type: 'licence',
      title: outcome.kind === 'expired' ? `${entry.title} has expired` : `${entry.title} expires on ${when}`,
      body: 'Ask for a renewal in Applications.',
      link: `/applications?renew=${entry.id}`,
    });
    await app.mailer
      .send(
        actionEmail({
          to: person.email,
          subject:
            outcome.kind === 'expired' ? `${entry.title} has expired` : `${entry.title} expires on ${when}`,
          greeting: `Hello ${person.name},`,
          lines:
            outcome.kind === 'expired'
              ? [
                  `The licence ${entry.title} (${entry.number}) expired on ${when} and now shows as expired in the public registry.`,
                  `You can still renew it for ${RENEWAL_GRACE_DAYS} days after the expiry date.`,
                ]
              : [
                  `The licence ${entry.title} (${entry.number}) expires on ${when}.`,
                  'Ask for a renewal now: a moderator checks it and the licence runs for another term.',
                ],
          action: { label: 'Renew the licence', url: `${web}/#/applications?renew=${entry.id}` },
        }),
      )
      .catch((err) => app.log.error({ err }, 'licence expiry email failed'));
  }
  return done;
}

export async function registryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['registry (public)'];
  const guard = apiKeyGuard(app, 'registry:read');
  const security: Record<string, string[]>[] = [{}, { apiKey: [] }, { bearerAuth: [] }];

  app.get(
    '/registry',
    {
      config: publicRouteConfig(app),
      preHandler: guard,
      schema: {
        tags,
        security,
        description:
          'Search the public registry of licenses, organizations and virtual countries. ' +
          'Open to everyone; send an X-API-Key for a higher rate limit.',
        querystring: registrySearchQuery,
        response: { 200: pageOf(registryEntrySchema) },
      },
    },
    async (req) => {
      const { q, kind, licenseType, status, limit, offset } = req.query;
      const filters: SQL[] = [];
      if (kind) filters.push(eq(registryEntries.kind, kind));
      if (licenseType) filters.push(eq(registryEntries.licenseType, licenseType));
      filters.push(eq(registryEntries.status, status ?? 'active'));
      if (q) {
        const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        filters.push(
          or(
            ilike(registryEntries.title, pattern),
            ilike(registryEntries.number, pattern),
            ilike(registryEntries.description, pattern),
            ilike(organizations.name, pattern),
            ilike(users.username, pattern),
          )!,
        );
      }
      const where = and(...filters);
      const [rows, [total]] = await Promise.all([
        registryQuery(app.db)
          .where(where)
          .orderBy(desc(registryEntries.issuedAt))
          .limit(limit)
          .offset(offset),
        app.db
          .select({ n: count() })
          .from(registryEntries)
          .leftJoin(users, eq(users.id, registryEntries.holderUserId))
          .leftJoin(organizations, eq(organizations.id, registryEntries.holderOrganizationId))
          .where(where),
      ]);
      return { items: rows.map(toRegistryDto), total: total?.n ?? 0, limit, offset };
    },
  );

  app.get(
    '/registry/:idOrNumber',
    {
      config: publicRouteConfig(app),
      preHandler: guard,
      schema: {
        tags,
        security,
        description: 'Look up one registry entry by id or registry number (e.g. OVL-LIC-000001).',
        params: z.object({ idOrNumber: z.string().min(1).max(64) }),
        response: { 200: registryEntrySchema },
      },
    },
    async (req) => {
      const entry = await getRegistryEntry(app.db, req.params.idOrNumber);
      if (!entry) throw notFound('Registry entry');
      return entry;
    },
  );

  app.scheduler.add({ name: 'licence-expiry', everySeconds: 3600, run: () => runLicenceExpiry(app) });

  app.get(
    '/me/licences',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        description:
          'Licences and virtual countries you hold, personally or through companies you own or direct, ' +
          'with their expiry dates and any renewal waiting for moderation.',
        response: { 200: z.array(myLicenceSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const orgIds = (
        await app.db
          .select({ id: organizationMembers.organizationId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.userId, me.id),
              inArray(organizationMembers.role, ['owner', 'director']),
            ),
          )
      ).map((r) => r.id);
      const rows = await registryQuery(app.db)
        .where(
          and(
            ne(registryEntries.kind, 'organization'),
            or(
              eq(registryEntries.holderUserId, me.id),
              orgIds.length ? inArray(registryEntries.holderOrganizationId, orgIds) : sql`false`,
            ),
          ),
        )
        .orderBy(registryEntries.expiresAt)
        .limit(200);
      const renewals = rows.length
        ? await app.db
            .select({
              id: applications.id,
              entryId: sql<string>`${applications.payload} ->> 'registryEntryId'`,
            })
            .from(applications)
            .where(
              and(
                eq(applications.type, 'renewal'),
                inArray(applications.status, ['pending', 'changes_requested']),
              ),
            )
        : [];
      return rows.map((row) => ({
        ...toRegistryDto(row),
        renewalApplicationId: renewals.find((r) => r.entryId === row.entry.id)?.id ?? null,
      }));
    },
  );

  app.get(
    '/registry/:idOrNumber/certificate.pdf',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        security: [{}],
        description:
          'A printable certificate for a registry entry, with a QR code to its public verification page. ' +
          'Revoked or suspended entries are marked "not valid".',
        params: z.object({ idOrNumber: z.string().min(1).max(64) }),
        querystring: z.object({ download: z.literal('1').optional() }),
      },
    },
    async (req, reply) => {
      const entry = await getRegistryEntry(app.db, req.params.idOrNumber);
      if (!entry) throw notFound('Registry entry');
      const kind =
        entry.kind === 'organization'
          ? 'Company registration'
          : entry.kind === 'virtual_country'
            ? 'Virtual country'
            : `${entry.licenseType ? LICENSE_TYPE_LABELS[entry.licenseType] : 'Virtual'} licence`;
      const pdf = await certificatePdf({
        number: entry.number,
        title: entry.title,
        company: entry.kind === 'organization',
        kind,
        description: entry.description,
        holder: {
          ...entry.holder,
          handle: entry.holder.type === 'user' ? `@${entry.holder.handle}` : entry.holder.handle,
        },
        website: entry.website,
        status: entry.status,
        issuedAt: new Date(entry.issuedAt),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
        verifyUrl: `${app.config.PUBLIC_WEB_URL.replace(/\/+$/, '')}/#/verify/${entry.number}`,
      });
      return reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `${req.query.download ? 'attachment' : 'inline'}; filename="${entry.number.toLowerCase()}-certificate.pdf"`,
        )
        .header('cache-control', 'public, max-age=300')
        .send(pdf);
    },
  );
}
