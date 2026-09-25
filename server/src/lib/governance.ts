import {
  COUNCIL_VOTING,
  WORKFLOWS,
  type ApplicationType,
  type CouncilRules,
  type CouncilVoting,
  type TransparencyStats,
} from '@ovl/shared';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { platformSettings, users } from '../db/schema';
import { audit } from './audit';
import { queueNotification } from './notify';

export interface GovernanceRules extends CouncilRules {
  councilTermMonths: number;
}

/** The governance settings, with the configured council quorum as the default. */
export async function loadGovernance(db: Db, fallbackQuorum = 3): Promise<GovernanceRules> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'governance'));
  const value = (row?.value ?? {}) as Partial<GovernanceRules>;
  return {
    councilVoting: COUNCIL_VOTING.includes(value.councilVoting as CouncilVoting)
      ? (value.councilVoting as CouncilVoting)
      : 'quorum',
    councilQuorum: value.councilQuorum ?? fallbackQuorum,
    councilTermMonths: value.councilTermMonths ?? 0,
  };
}

/** When a council seat that starts now ends (null: no term limit). */
export function termEnd(months: number, from = new Date()): Date | null {
  if (!months) return null;
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

/**
 * Council seats whose term is over go back to regular accounts (and leave the council chat).
 * Claimed row by row, so several instances never end the same term twice.
 */
export async function expireCouncilTerms(app: FastifyInstance, now = new Date()) {
  const { changeRole } = await import('../modules/roles');
  let ended = 0;
  for (let i = 0; i < 200; i++) {
    const member = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          and(
            eq(users.role, 'council'),
            isNotNull(users.councilTermEndsAt),
            lte(users.councilTermEndsAt, now),
          ),
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      await changeRole(tx, row.id, 'user');
      await audit(tx, {
        actorId: null,
        action: 'council.term_ended',
        targetType: 'user',
        targetId: row.id,
        data: {},
      });
      await queueNotification(tx, [row.id], {
        type: 'application',
        title: 'Your council term has ended',
        body: 'Thank you for serving. You can apply to join the council again.',
        link: '/applications',
      });
      return row;
    });
    if (!member) break;
    app.hub.updateRole(member.id, 'user');
    ended++;
  }
  return ended;
}

const n = (v: unknown) => Number(v ?? 0);

/** What happened on the platform between `from` and `to`, for a transparency report. */
export async function transparencyStats(db: Db, from: Date, to: Date): Promise<TransparencyStats> {
  const within = (column: string) =>
    sql.raw(`${column} >= '${from.toISOString()}' and ${column} < '${to.toISOString()}'`);
  const one = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => {
    const rows = await db.execute<T>(query);
    return ([...rows][0] ?? {}) as T;
  };
  const [apps, byType, votes, members, moderation, identity, support, registry, economy] = await Promise.all([
    one<{ received: string; approved: string; rejected: string; median: string | null }>(sql`
      select count(*) filter (where ${within('created_at')}) as received,
             count(*) filter (where status = 'approved' and ${within('decided_at')}) as approved,
             count(*) filter (where status = 'rejected' and ${within('decided_at')}) as rejected,
             percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 3600)
               filter (where decided_at is not null and ${within('decided_at')}) as median
      from applications`),
    db.execute<{ type: ApplicationType; received: string; approved: string; rejected: string }>(sql`
      select type,
             count(*) filter (where ${within('created_at')}) as received,
             count(*) filter (where status = 'approved' and ${within('decided_at')}) as approved,
             count(*) filter (where status = 'rejected' and ${within('decided_at')}) as rejected
      from applications group by type order by type`),
    one<{ votes: string; approvals: string; rejections: string; changes: string }>(sql`
      select count(*) filter (where reviewer_role = 'council') as votes,
             count(*) filter (where reviewer_role = 'council' and decision = 'approve') as approvals,
             count(*) filter (where reviewer_role = 'council' and decision = 'reject') as rejections,
             count(*) filter (where decision = 'request_changes') as changes
      from application_reviews where ${within('created_at')}`),
    one<{ members: string }>(
      sql`select count(*) as members from users where role = 'council' and status = 'active'`,
    ),
    one<{ suspended: string }>(sql`
      select count(*) as suspended from audit_logs
      where action = 'user.update' and data -> 'to' ->> 'status' = 'suspended' and ${within('created_at')}`),
    one<{ approved: string; rejected: string }>(sql`
      select count(*) filter (where status = 'approved') as approved,
             count(*) filter (where status = 'rejected') as rejected
      from identity_checks where ${within('reviewed_at')}`),
    one<{ opened: string; open: string }>(sql`
      select count(*) filter (where ${within('created_at')}) as opened,
             count(*) filter (where support_status = 'open') as open
      from chats where type = 'support'`),
    one<{ added: string; expired: string; revoked: string; active: string }>(sql`
      select count(*) filter (where ${within('issued_at')}) as added,
             count(*) filter (where status = 'expired' and ${within('updated_at')}) as expired,
             count(*) filter (where status in ('revoked', 'suspended') and ${within('updated_at')}) as revoked,
             count(*) filter (where status = 'active') as active
      from registry_entries`),
    one<{ accounts: string; listed: string; investments: string; trades: string }>(sql`
      select (select count(*) from users where ${within('created_at')}) as accounts,
             (select count(*) from stock_listings where ${within('listed_at')}) as listed,
             (select count(*) from investments where ${within('created_at')}) as investments,
             (select count(*) from stock_trades where ${within('created_at')}) as trades`),
  ]);
  return {
    applications: {
      received: n(apps.received),
      approved: n(apps.approved),
      rejected: n(apps.rejected),
      changesRequested: n(votes.changes),
      medianDecisionHours:
        apps.median === null || apps.median === undefined ? null : Math.round(Number(apps.median) * 10) / 10,
      byType: [...byType]
        .filter((t) => n(t.received) + n(t.approved) + n(t.rejected) > 0)
        .map((t) => ({
          type: t.type,
          label: WORKFLOWS[t.type]?.label ?? t.type,
          received: n(t.received),
          approved: n(t.approved),
          rejected: n(t.rejected),
        })),
    },
    council: {
      members: n(members.members),
      votes: n(votes.votes),
      approvals: n(votes.approvals),
      rejections: n(votes.rejections),
    },
    moderation: {
      accountsSuspended: n(moderation.suspended),
      identityApproved: n(identity.approved),
      identityRejected: n(identity.rejected),
      registryRevoked: n(registry.revoked),
    },
    support: { ticketsOpened: n(support.opened), ticketsOpenNow: n(support.open) },
    registry: { added: n(registry.added), expired: n(registry.expired), active: n(registry.active) },
    economy: {
      newAccounts: n(economy.accounts),
      companiesListed: n(economy.listed),
      investments: n(economy.investments),
      trades: n(economy.trades),
    },
  };
}
