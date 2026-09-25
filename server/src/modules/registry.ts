import {
  LICENSE_TYPE_LABELS,
  pageOf,
  registryEntrySchema,
  registrySearchQuery,
  type LicenseType,
  type RegistryEntry,
} from '@ovl/shared';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { organizations, registryCounters, registryEntries, users } from '../db/schema';
import { notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import { certificatePdf } from '../lib/pdf';
import { apiKeyGuard, publicRouteConfig } from '../lib/public-api';

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
    })
    .returning();
  return entry!;
}

const registrySelect = {
  entry: registryEntries,
  userName: users.displayName,
  username: users.username,
  orgName: organizations.name,
  orgSlug: organizations.slug,
  orgVerifiedAt: organizations.verifiedAt,
  orgStatus: organizations.status,
};

type RegistryRow = {
  entry: typeof registryEntries.$inferSelect;
  userName: string | null;
  username: string | null;
  orgName: string | null;
  orgSlug: string | null;
  orgVerifiedAt: Date | null;
  orgStatus: 'active' | 'suspended' | null;
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
    updatedAt: iso(entry.updatedAt),
  };
}

export function registryQuery(db: Db) {
  return db
    .select(registrySelect)
    .from(registryEntries)
    .leftJoin(users, eq(users.id, registryEntries.holderUserId))
    .leftJoin(organizations, eq(organizations.id, registryEntries.holderOrganizationId));
}

export async function getRegistryEntry(db: Db, idOrNumber: string): Promise<RegistryEntry | null> {
  const isUuid = z.uuid().safeParse(idOrNumber).success;
  const [row] = await registryQuery(db).where(
    isUuid ? eq(registryEntries.id, idOrNumber) : eq(registryEntries.number, idOrNumber.toUpperCase()),
  );
  return row ? toRegistryDto(row) : null;
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
