import {
  companyApplicationSchema,
  licenseApplicationSchema,
  newsChannelApplicationSchema,
  parseAmount,
  renewalApplicationSchema,
  type Role,
} from '@ovl/shared';
import { eq, like } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import {
  applications,
  chats,
  organizationMembers,
  organizations,
  registryEntries,
  users,
} from '../../db/schema';
import { conflict } from '../../lib/errors';
import { slugify } from '../../lib/slug';
import { createChannel } from '../chats/service';
import { issueRegistryEntry, licenceExpiry } from '../registry';
import { changeRole } from '../roles';
import { createListing } from '../stock/service';
import { getOrCreateWallet } from '../wallets/service';

type ApplicationRow = typeof applications.$inferSelect;

export interface EffectResult {
  result: Record<string, unknown>;
  roleChanges: { userId: string; role: Role }[];
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  const rows = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(like(organizations.slug, `${base}%`));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** What happens when the last stage of an application is approved. Runs inside the review transaction. */
export async function applyApprovedApplication(
  db: Db,
  config: Config,
  application: ApplicationRow,
): Promise<EffectResult> {
  switch (application.type) {
    case 'company': {
      const p = companyApplicationSchema.parse(application.payload);
      const slug = await uniqueSlug(db, p.name);
      const [founder] = await db
        .select({ identityVerifiedAt: users.identityVerifiedAt })
        .from(users)
        .where(eq(users.id, application.applicantId));
      const [org] = await db
        .insert(organizations)
        .values({
          name: p.name,
          slug,
          description: p.description,
          website: p.website || null,
          country: p.country || null,
          baseCurrency: p.baseCurrency,
          ownerId: application.applicantId,
          applicationId: application.id,
          // A verified business from day one when its owner already passed an identity check.
          verifiedAt: founder?.identityVerifiedAt ? new Date() : null,
        })
        .returning();
      await db
        .insert(organizationMembers)
        .values({ organizationId: org!.id, userId: application.applicantId, role: 'owner' });
      await getOrCreateWallet(db, { type: 'organization', id: org!.id }, p.baseCurrency);
      const orgEntry = await issueRegistryEntry(db, {
        kind: 'organization',
        title: p.name,
        description: p.description,
        website: p.website,
        holder: { type: 'organization', id: org!.id },
        applicationId: application.id,
        data: { country: p.country ?? null, baseCurrency: p.baseCurrency },
      });
      const license = await issueRegistryEntry(db, {
        kind: 'license',
        licenseType: 'business',
        title: `${p.name} — business license`,
        description: p.businessPlan.slice(0, 2000),
        website: p.website,
        holder: { type: 'organization', id: org!.id },
        applicationId: application.id,
      });
      await db
        .update(organizations)
        .set({ registryNumber: orgEntry.number })
        .where(eq(organizations.id, org!.id));
      let ticker: string | null = null;
      if (p.listOnExchange && p.listing) {
        const listing = await createListing(db, {
          organizationId: org!.id,
          ticker: p.listing.ticker,
          currency: p.baseCurrency,
          sharePrice: parseAmount(p.listing.sharePrice, p.baseCurrency),
          totalShares: BigInt(p.listing.totalShares),
          freezePercent: config.STOCK_FREEZE_PERCENT,
          lockDays: config.STOCK_LOCK_DAYS,
        });
        ticker = listing.ticker;
      }
      return {
        result: {
          organizationId: org!.id,
          organizationSlug: slug,
          registryNumber: orgEntry.number,
          licenseNumber: license.number,
          ticker,
        },
        roleChanges: [],
      };
    }

    case 'license': {
      const p = licenseApplicationSchema.parse(application.payload);
      const entry = await issueRegistryEntry(db, {
        expiresAt: licenceExpiry(config),
        kind: p.licenseType === 'virtual_country' ? 'virtual_country' : 'license',
        licenseType: p.licenseType,
        title: p.title,
        description: p.description,
        website: p.website,
        holder: p.organizationId
          ? { type: 'organization', id: p.organizationId }
          : { type: 'user', id: application.applicantId },
        applicationId: application.id,
        data: p.details ? { details: p.details } : {},
      });
      return { result: { registryNumber: entry.number, registryEntryId: entry.id }, roleChanges: [] };
    }

    case 'moderator':
    case 'council': {
      const [user] = await db.select().from(users).where(eq(users.id, application.applicantId));
      const allowedFrom: Role[] = application.type === 'moderator' ? ['user'] : ['user', 'moderator'];
      if (!user || !allowedFrom.includes(user.role)) {
        throw conflict(
          `The applicant's role changed to ${user?.role ?? 'unknown'}; reject this application instead`,
        );
      }
      await changeRole(db, user.id, application.type);
      return {
        result: { role: application.type },
        roleChanges: [{ userId: user.id, role: application.type }],
      };
    }

    case 'renewal': {
      const p = renewalApplicationSchema.parse(application.payload);
      const [entry] = await db
        .select()
        .from(registryEntries)
        .where(eq(registryEntries.id, p.registryEntryId))
        .for('update');
      if (!entry || (entry.status !== 'active' && entry.status !== 'expired'))
        throw conflict(`This licence is ${entry?.status ?? 'gone'}; reject the renewal instead`);
      // A new term from the old expiry date (renewed early) or from today (renewed late).
      const base = entry.expiresAt && entry.expiresAt > new Date() ? entry.expiresAt : new Date();
      const expiresAt = licenceExpiry(config, base);
      await db
        .update(registryEntries)
        .set({ status: 'active', expiresAt, reminderStage: 0, updatedAt: new Date() })
        .where(eq(registryEntries.id, entry.id));
      return {
        result: {
          registryNumber: entry.number,
          registryEntryId: entry.id,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
        roleChanges: [],
      };
    }

    case 'news_channel': {
      const p = newsChannelApplicationSchema.parse(application.payload);
      const [taken] = await db.select({ id: chats.id }).from(chats).where(eq(chats.handle, p.handle));
      if (taken)
        throw conflict(
          `The channel handle @${p.handle} was taken meanwhile; reject this application instead`,
        );
      const channel = await createChannel(db, { ...p, ownerId: application.applicantId });
      return { result: { chatId: channel.id, handle: p.handle }, roleChanges: [] };
    }
  }
}
