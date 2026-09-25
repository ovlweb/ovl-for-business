import {
  formatAmount,
  intlTag,
  monthlyStatementSchema,
  ORG_FINANCE_ROLES,
  statementLinkInputSchema,
  statementLinkSchema,
  statementRangeSchema,
  type MonthlyStatement,
  type StatementRange,
} from '@ovl/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  ledgerEntries,
  organizationMembers,
  organizations,
  sessions,
  statementNotices,
  users,
  wallets,
} from '../db/schema';
import { notFound, unauthorized } from '../lib/errors';
import { iso } from '../lib/mappers';
import { actionEmail } from '../lib/mailer';
import { groupAmount, statementPdf } from '../lib/pdf';
import { openLink, signLink } from '../lib/signed-links';
import { currentUser } from '../plugins/auth';
import { assertWalletAccess, type WalletRow } from './wallets/service';
import { label, say, text, userLocale } from '../lib/i18n';

/** Links for the system browser; emailed monthly statements stay valid for a week. */
const LINK_TTL_MS = 5 * 60_000;
const EMAIL_LINK_TTL_MS = 7 * 86_400_000;
const PDF_MAX_ENTRIES = 5_000;

interface StatementLinkPayload extends Record<string, unknown> {
  u: string;
  /** The session the link was made in (signing out kills it); null for emailed links. */
  s: string | null;
  w: string;
  from?: string;
  to?: string;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Free text: spreadsheets must not run it as a formula. */
function csvText(value: string): string {
  return csvCell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

const inRange = ({ from, to }: StatementRange) =>
  and(
    from ? sql`${ledgerEntries.createdAt} >= ${from}::date` : undefined,
    to ? sql`${ledgerEntries.createdAt} < ${to}::date + 1` : undefined,
  );

/** The previous calendar month (UTC) as YYYY-MM and its first and last day. */
export function previousMonth(now = new Date()) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    month: first.toISOString().slice(0, 7),
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    label: first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

async function ownerOf(db: Db, wallet: WalletRow) {
  if (wallet.ownerType === 'user') {
    const [u] = await db
      .select({ name: users.displayName, handle: users.username })
      .from(users)
      .where(eq(users.id, wallet.userId!));
    return { name: u?.name ?? '', handle: `@${u?.handle ?? ''}`, type: 'user' as const };
  }
  const [o] = await db
    .select({ name: organizations.name, handle: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, wallet.organizationId!));
  return { name: o?.name ?? '', handle: o?.handle ?? '', type: 'organization' as const };
}

export async function renderStatementPdf(db: Db, wallet: WalletRow, range: StatementRange): Promise<Buffer> {
  const [before] = range.from
    ? await db
        .select({ balance: ledgerEntries.balanceAfter })
        .from(ledgerEntries)
        .where(
          and(eq(ledgerEntries.walletId, wallet.id), sql`${ledgerEntries.createdAt} < ${range.from}::date`),
        )
        .orderBy(desc(ledgerEntries.id))
        .limit(1)
    : [];
  const [totals] = await db
    .select({
      moneyIn: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.amount} > 0), 0)`,
      moneyOut: sql<string>`coalesce(-sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.amount} < 0), 0)`,
      last: sql<
        string | null
      >`(array_agg(${ledgerEntries.balanceAfter} order by ${ledgerEntries.id} desc))[1]`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.walletId, wallet.id), inRange(range)));
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.walletId, wallet.id), inRange(range)))
    .orderBy(ledgerEntries.id)
    .limit(PDF_MAX_ENTRIES + 1);
  const opening = before?.balance ?? 0n;
  return statementPdf({
    owner: await ownerOf(db, wallet),
    currency: wallet.currency,
    from: range.from ?? null,
    to: range.to ?? null,
    opening,
    closing: totals?.last != null ? BigInt(totals.last) : opening,
    moneyIn: BigInt(totals?.moneyIn ?? 0),
    moneyOut: BigInt(totals?.moneyOut ?? 0),
    entries: rows.slice(0, PDF_MAX_ENTRIES),
    truncated: rows.length > PDF_MAX_ENTRIES,
    generatedAt: new Date(),
  });
}

async function monthlyStatements(db: Db, wallet: WalletRow, limit = 24): Promise<MonthlyStatement[]> {
  const month = sql<string>`to_char(date_trunc('month', ${ledgerEntries.createdAt} at time zone 'UTC'), 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      operations: sql<number>`count(*)::int`,
      moneyIn: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.amount} > 0), 0)`,
      moneyOut: sql<string>`coalesce(-sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.amount} < 0), 0)`,
      opening: sql<string>`(array_agg(${ledgerEntries.balanceAfter} - ${ledgerEntries.amount} order by ${ledgerEntries.id}))[1]`,
      closing: sql<string>`(array_agg(${ledgerEntries.balanceAfter} order by ${ledgerEntries.id} desc))[1]`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.walletId, wallet.id))
    .groupBy(month)
    .orderBy(desc(month))
    .limit(limit);
  const money = (v: string) => formatAmount(BigInt(v), wallet.currency);
  return rows.map((r) => {
    const [y, m] = r.month.split('-').map(Number);
    return {
      month: r.month,
      from: `${r.month}-01`,
      to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10),
      opening: money(r.opening),
      moneyIn: money(r.moneyIn),
      moneyOut: money(r.moneyOut),
      closing: money(r.closing),
      operations: r.operations,
    };
  });
}

/**
 * At the start of each month, email everyone who asked for it a PDF statement link for each
 * balance they can see that moved last month. Each person gets it once, whichever instance runs.
 */
export async function sendMonthlyStatements(app: FastifyInstance, now = new Date()): Promise<number> {
  if (now.getUTCDate() > 5) return 0;
  const period = previousMonth(now);
  const base = app.config.PUBLIC_WEB_URL.replace(/\/+$/, '');
  const people = await app.db
    .select({ id: users.id, email: users.email, name: users.displayName, preferences: users.preferences })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
        sql`${users.preferences} ->> 'statementEmails' = 'true'`,
      ),
    )
    .limit(1000);
  let sent = 0;
  for (const person of people) {
    const locale = userLocale(person.preferences);
    const month = new Date(`${period.from}T00:00:00Z`).toLocaleString(intlTag(locale) ?? 'en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const [claimed] = await app.db
      .insert(statementNotices)
      .values({ userId: person.id, month: period.month })
      .onConflictDoNothing()
      .returning();
    if (!claimed) continue;
    const orgIds = (
      await app.db
        .select({ id: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, person.id),
            inArray(organizationMembers.role, [...ORG_FINANCE_ROLES]),
          ),
        )
    ).map((r) => r.id);
    const visible = await app.db
      .select()
      .from(wallets)
      .where(
        or(
          eq(wallets.userId, person.id),
          orgIds.length ? inArray(wallets.organizationId, orgIds) : sql`false`,
        ),
      );
    const moved = await app.db
      .selectDistinct({ walletId: ledgerEntries.walletId })
      .from(ledgerEntries)
      .where(
        and(
          inArray(
            ledgerEntries.walletId,
            visible.map((w) => w.id).concat(['00000000-0000-0000-0000-000000000000']),
          ),
          inRange(period),
        ),
      );
    const active = visible.filter((w) => moved.some((m) => m.walletId === w.id));
    if (!active.length) continue;
    const links = [];
    for (const wallet of active) {
      const owner = await ownerOf(app.db, wallet);
      const [last] = await app.db
        .select({ balance: ledgerEntries.balanceAfter })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.walletId, wallet.id),
            lt(ledgerEntries.createdAt, sql`${period.to}::date + 1`),
          ),
        )
        .orderBy(desc(ledgerEntries.id))
        .limit(1);
      const payload: StatementLinkPayload = {
        u: person.id,
        s: null,
        w: wallet.id,
        from: period.from,
        to: period.to,
      };
      const link = signLink(payload, app.config.JWT_SECRET, EMAIL_LINK_TTL_MS);
      links.push({
        label: say(
          locale,
          text`${owner.type === 'organization' ? owner.name : label('Personal')} · ${wallet.currency} — closing balance ${groupAmount(last?.balance ?? 0n, wallet.currency)} ${wallet.currency} (PDF)`,
        ),
        url: `${base}/api/v1/wallets/${wallet.id}/statement.pdf?link=${link}`,
      });
    }
    await app.mailer
      .send(
        actionEmail({
          to: person.email,
          locale,
          subject: text`Your statements for ${month}`,
          greeting: text`Hello ${person.name},`,
          lines: [
            links.length === 1
              ? text`Your ${month} statements are ready: one balance moved last month.`
              : text`Your ${month} statements are ready: ${links.length} balances moved last month.`,
            'The download links work for 7 days. You can also download any month from the wallet page.',
          ],
          links,
          action: { label: 'Open the wallet', url: `${base}/#/wallet` },
          footer: 'You get this email because monthly statements are on in Settings → Notifications.',
        }),
      )
      .then(() => sent++)
      .catch((err) => app.log.error({ err }, 'monthly statement email failed'));
  }
  return sent;
}

export async function statementRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['wallets'];

  app.scheduler.add({
    name: 'monthly-statements',
    everySeconds: 3600,
    run: () => sendMonthlyStatements(app),
  });

  const loadWallet = async (id: string) => {
    const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, id));
    if (!wallet) throw notFound('Wallet');
    return wallet;
  };

  /** The person a download link was made for, if the account (and its session) are still live. */
  const linkUser = async (payload: StatementLinkPayload) => {
    const [user] = await app.db
      .select({ id: users.id, role: users.role, status: users.status, session: sessions.id })
      .from(users)
      .leftJoin(
        sessions,
        payload.s
          ? and(eq(sessions.id, payload.s), eq(sessions.userId, users.id), isNull(sessions.revokedAt))
          : sql`false`,
      )
      .where(eq(users.id, payload.u));
    if (!user || user.status !== 'active' || (payload.s && !user.session))
      throw unauthorized('This download link is no longer valid');
    return user;
  };

  /** A wallet the caller (or the signed link) may read, and the range to export. */
  const authorize = async (
    walletId: string,
    query: StatementRange & { link?: string },
    req: Parameters<typeof currentUser>[0],
  ) => {
    const wallet = await loadWallet(walletId);
    if (query.link) {
      const payload = openLink<StatementLinkPayload>(query.link, app.config.JWT_SECRET);
      if (!payload || payload.w !== wallet.id) throw unauthorized('This download link is no longer valid');
      await assertWalletAccess(app.db, wallet, await linkUser(payload));
      return { wallet, range: { from: payload.from, to: payload.to } };
    }
    await assertWalletAccess(app.db, wallet, currentUser(req));
    return { wallet, range: { from: query.from, to: query.to } };
  };
  const tokenOrLink = async (req: Parameters<typeof currentUser>[0], reply: FastifyReply) => {
    if (!(req.query as { link?: string }).link) await app.authenticate(req, reply);
  };
  const fileName = (wallet: WalletRow, range: StatementRange, ext: string) =>
    `ovl-statement-${wallet.currency.toLowerCase()}-${range.from && range.to && range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith('-01') ? range.from.slice(0, 7) : new Date().toISOString().slice(0, 10)}.${ext}`;

  app.post(
    '/wallets/:id/statement-link',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'A download link for the statement (CSV or PDF) that works for 5 minutes without an Authorization ' +
          'header (for apps that open the file in the system browser).',
        params: z.object({ id: z.uuid() }),
        body: statementLinkInputSchema,
        response: { 200: statementLinkSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, me);
      const { format, ...range } = req.body;
      const payload: StatementLinkPayload = { u: me.id, s: me.sessionId, w: wallet.id, ...range };
      const link = signLink(payload, app.config.JWT_SECRET, LINK_TTL_MS);
      return {
        path: `/api/v1/wallets/${wallet.id}/statement.${format}?link=${link}`,
        expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString(),
      };
    },
  );

  app.get(
    '/wallets/:id/statement.csv',
    {
      // Either a normal access token or a link from POST /wallets/:id/statement-link.
      preHandler: tokenOrLink,
      schema: {
        tags,
        description: 'Download the statement as CSV (spreadsheets, accounting). Optional ISO date range.',
        params: z.object({ id: z.uuid() }),
        querystring: statementRangeSchema.extend({ link: z.string().max(2048).optional() }),
      },
    },
    async (req, reply) => {
      const { wallet, range } = await authorize(req.params.id, req.query, req);
      const rows = await app.db
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.walletId, wallet.id), inRange(range)))
        .orderBy(ledgerEntries.id)
        .limit(50_000);
      const lines = [
        ['Date', 'Operation', 'Description', 'Amount', 'Balance after', 'Currency', 'Entry'].join(','),
        ...rows.map((e) =>
          [
            csvCell(iso(e.createdAt)),
            csvCell(e.kind),
            csvText(e.description),
            csvCell(formatAmount(e.amount, wallet.currency)),
            csvCell(formatAmount(e.balanceAfter, wallet.currency)),
            csvCell(wallet.currency),
            String(e.id),
          ].join(','),
        ),
      ];
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName(wallet, range, 'csv')}"`)
        .header('cache-control', 'private, no-store')
        .send(`﻿${lines.join('\r\n')}\r\n`);
    },
  );

  app.get(
    '/wallets/:id/statement.pdf',
    {
      preHandler: tokenOrLink,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        description:
          'The statement as a printable PDF: opening and closing balance, money in and out, every operation. ' +
          'Optional ISO date range; a signed link works too.',
        params: z.object({ id: z.uuid() }),
        querystring: statementRangeSchema.extend({
          link: z.string().max(2048).optional(),
          download: z.literal('1').optional(),
        }),
      },
    },
    async (req, reply) => {
      const { wallet, range } = await authorize(req.params.id, req.query, req);
      const pdf = await renderStatementPdf(app.db, wallet, range);
      return reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `${req.query.download ? 'attachment' : 'inline'}; filename="${fileName(wallet, range, 'pdf')}"`,
        )
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );

  app.get(
    '/wallets/:id/statements',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Monthly statements (UTC calendar months with activity, newest first, up to two years).',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.array(monthlyStatementSchema) },
      },
    },
    async (req) => {
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      return monthlyStatements(app.db, wallet);
    },
  );
}
