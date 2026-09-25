import {
  castVoteSchema,
  companyReportSchema,
  createProposalSchema,
  createReportSchema,
  dividendInputSchema,
  dividendSchema,
  formatAmount,
  parseAmount,
  proposalSchema,
  shareholderSchema,
  type CompanyReport,
  type Dividend,
  type Proposal,
} from '@ovl/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client';
import {
  companyReports,
  dividends,
  organizations,
  proposals,
  proposalVoters,
  shareholdings,
  stockListings,
  users,
  wallets,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { iso, isoOrNull } from '../../lib/mappers';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { attachFiles, fileDtos, filesOf } from '../files';
import { announceApproval, needsSecondSignature, requestSecondSignature } from '../org-payments';
import { walletAudience } from '../wallets/routes';
import {
  assertWalletAccess,
  credit,
  debit,
  getOrCreateWallet,
  orgRoleOf,
  type WalletRow,
} from '../wallets/service';

type DividendRow = typeof dividends.$inferSelect;
type ProposalRow = typeof proposals.$inferSelect;
type ListingRow = typeof stockListings.$inferSelect;

const DEFAULT_OPTIONS = ['For', 'Against', 'Abstain'];

async function people(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; username: string; displayName: string }>();
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}
const refOf = (map: Map<string, { id: string; username: string; displayName: string }>, id: string) =>
  map.get(id) ?? { id, username: '', displayName: '' };

/** Everyone holding shares right now (the record date of dividends and votes). */
async function holders(db: Db, listingId: string) {
  return db
    .select({ userId: shareholdings.userId, shares: shareholdings.shares })
    .from(shareholdings)
    .where(and(eq(shareholdings.listingId, listingId), gt(shareholdings.shares, 0n)));
}

async function dividendDtos(db: Db, rows: DividendRow[], listing: ListingRow): Promise<Dividend[]> {
  const who = await people(
    db,
    rows.map((r) => r.createdBy),
  );
  return rows.map((d) => ({
    id: d.id,
    ticker: listing.ticker,
    currency: listing.currency,
    perShare: formatAmount(d.perShare, listing.currency),
    shares: d.shares.toString(),
    holders: d.holders,
    total: formatAmount(d.total, listing.currency),
    note: d.note,
    status: d.status,
    approvalId: d.approvalId,
    createdBy: refOf(who, d.createdBy),
    createdAt: iso(d.createdAt),
    paidAt: isoOrNull(d.paidAt),
  }));
}

/** Pay a declared dividend from the company balance; call inside a transaction. */
async function executeDividend(tx: Db, dividend: DividendRow, listing: ListingRow, actorId: string) {
  const [org] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, listing.organizationId));
  const reference = { actorId, referenceType: 'dividend', referenceId: dividend.id };
  const per = `${formatAmount(dividend.perShare, listing.currency)} ${listing.currency} a share`;
  await debit(tx, dividend.walletId, dividend.total, 'dividend_out', {
    ...reference,
    description: `Dividend ${listing.ticker}: ${per} to ${dividend.holders} shareholders`,
  });
  const touched: WalletRow[] = [];
  for (const r of dividend.recipients) {
    const wallet = await getOrCreateWallet(tx, { type: 'user', id: r.userId }, listing.currency);
    await credit(tx, wallet.id, BigInt(r.shares) * dividend.perShare, 'dividend_in', {
      ...reference,
      description: `Dividend from ${org?.name ?? listing.ticker}: ${r.shares} × ${per}`,
      counterpartyWalletId: dividend.walletId,
    });
    touched.push(wallet);
  }
  await tx.update(dividends).set({ status: 'paid', paidAt: new Date() }).where(eq(dividends.id, dividend.id));
  return touched;
}

/** The second signature arrived (see org-payments). */
export async function approveDividend(tx: Db, dividendId: string, actorId: string) {
  const [dividend] = await tx.select().from(dividends).where(eq(dividends.id, dividendId)).for('update');
  if (!dividend) throw notFound('Dividend');
  if (dividend.status !== 'pending') throw conflict(`This dividend is already ${dividend.status}`);
  const [listing] = await tx.select().from(stockListings).where(eq(stockListings.id, dividend.listingId));
  return executeDividend(tx, dividend, listing!, actorId);
}

export async function releaseDividend(tx: Db, dividendId: string) {
  await tx
    .update(dividends)
    .set({ status: 'rejected' })
    .where(and(eq(dividends.id, dividendId), eq(dividends.status, 'pending')));
}

function proposalOpen(p: ProposalRow, now = new Date()) {
  return !p.closedEarlyAt && p.closesAt > now;
}

async function proposalDtos(db: Db, rows: ProposalRow[], viewerId?: string): Promise<Proposal[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [tallies, mine, listings, who] = await Promise.all([
    db
      .select({
        proposalId: proposalVoters.proposalId,
        option: proposalVoters.option,
        shares: sql<string>`sum(${proposalVoters.shares})`,
        voters: sql<number>`count(*)::int`,
      })
      .from(proposalVoters)
      .where(and(inArray(proposalVoters.proposalId, ids), sql`${proposalVoters.option} is not null`))
      .groupBy(proposalVoters.proposalId, proposalVoters.option),
    viewerId
      ? db
          .select()
          .from(proposalVoters)
          .where(and(inArray(proposalVoters.proposalId, ids), eq(proposalVoters.userId, viewerId)))
      : Promise.resolve([]),
    db
      .select({ id: stockListings.id, ticker: stockListings.ticker, orgName: organizations.name })
      .from(stockListings)
      .innerJoin(organizations, eq(organizations.id, stockListings.organizationId))
      .where(
        inArray(
          stockListings.id,
          rows.map((r) => r.listingId),
        ),
      ),
    people(
      db,
      rows.map((r) => r.createdBy),
    ),
  ]);
  return rows.map((p) => {
    const listing = listings.find((l) => l.id === p.listingId)!;
    const options = p.options.map((o) => {
      const t = tallies.find((x) => x.proposalId === p.id && x.option === o.key);
      return { ...o, shares: t?.shares ?? '0', voters: t?.voters ?? 0 };
    });
    const voted = options.reduce((n, o) => n + BigInt(o.shares), 0n);
    const open = proposalOpen(p);
    const sorted = [...options].sort((a, b) => Number(BigInt(b.shares) - BigInt(a.shares)));
    const winner =
      !open && sorted[0] && BigInt(sorted[0].shares) > 0n && sorted[0].shares !== sorted[1]?.shares
        ? sorted[0].key
        : null;
    const me = mine.find((m) => m.proposalId === p.id);
    return {
      id: p.id,
      ticker: listing.ticker,
      organizationName: listing.orgName,
      title: p.title,
      description: p.description,
      options,
      status: open ? 'open' : 'closed',
      closesAt: iso(p.closedEarlyAt ?? p.closesAt),
      totalShares: p.totalShares.toString(),
      votedShares: voted.toString(),
      turnoutPercent: p.totalShares > 0n ? Number((voted * 10_000n) / p.totalShares) / 100 : 0,
      winner,
      myShares: (me?.shares ?? 0n).toString(),
      myVote: me?.option ?? null,
      createdBy: refOf(who, p.createdBy),
      createdAt: iso(p.createdAt),
    };
  });
}

async function reportDtos(
  app: FastifyInstance,
  rows: (typeof companyReports.$inferSelect)[],
): Promise<CompanyReport[]> {
  if (!rows.length) return [];
  const [who, files] = await Promise.all([
    people(
      app.db,
      rows.map((r) => r.authorId),
    ),
    filesOf(
      app.db,
      'report',
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    period: r.period,
    title: r.title,
    body: r.body,
    currency: r.currency,
    revenue: r.revenue === null ? null : formatAmount(r.revenue, r.currency),
    profit: r.profit === null ? null : formatAmount(r.profit, r.currency),
    files: fileDtos(
      app,
      files.filter((f) => f.scopeId === r.id),
    ),
    author: refOf(who, r.authorId),
    publishedAt: iso(r.publishedAt),
  }));
}

const signed = (decimal: string, currency: string) =>
  decimal.startsWith('-') ? -parseAmount(decimal.slice(1), currency) : parseAmount(decimal, currency);

export async function shareholderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['shareholders'];

  const listingOfOrg = async (orgId: string) => {
    const [listing] = await app.db
      .select()
      .from(stockListings)
      .where(eq(stockListings.organizationId, orgId));
    if (!listing) throw badRequest('This company is not listed on the exchange');
    return listing;
  };
  const listingByTicker = async (ticker: string) => {
    const [listing] = await app.db
      .select()
      .from(stockListings)
      .where(eq(stockListings.ticker, ticker.toUpperCase()));
    if (!listing) throw notFound('Listing');
    return listing;
  };
  /** Owners and directors act for the company towards its shareholders. */
  const requireManager = async (orgId: string, user: AuthUser) => {
    const role = await orgRoleOf(app.db, orgId, user.id);
    if (role !== 'owner' && role !== 'director') throw forbidden('Only the owner or a director can do this');
    return role;
  };
  const notifyHolders = async (listing: ListingRow) => {
    const rows = await holders(app.db, listing.id);
    app.hub.sendToUsers(
      rows.map((r) => r.userId),
      { type: 'stock.updated', ticker: listing.ticker },
    );
  };

  // ----- Shareholder registry ------------------------------------------------------------

  app.get(
    '/organizations/:id/shareholders',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Who holds the company shares (members of the company only).',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.array(shareholderSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      if (!(await orgRoleOf(app.db, req.params.id, me.id))) throw forbidden('Only company members see this');
      const listing = await listingOfOrg(req.params.id);
      const rows = await holders(app.db, listing.id);
      const total = rows.reduce((n, r) => n + r.shares, 0n);
      const who = await people(
        app.db,
        rows.map((r) => r.userId),
      );
      return rows
        .sort((a, b) => Number(b.shares - a.shares))
        .map((r) => ({
          user: refOf(who, r.userId),
          shares: r.shares.toString(),
          percent: total > 0n ? Number((r.shares * 10_000n) / total) / 100 : 0,
        }));
    },
  );

  // ----- Dividends ----------------------------------------------------------------------

  app.get(
    '/stock/listings/:ticker/dividends',
    {
      schema: {
        tags,
        security: [],
        description: 'Dividends the company declared, newest first.',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        response: { 200: z.array(dividendSchema) },
      },
    },
    async (req) => {
      const listing = await listingByTicker(req.params.ticker);
      const rows = await app.db
        .select()
        .from(dividends)
        .where(eq(dividends.listingId, listing.id))
        .orderBy(desc(dividends.createdAt))
        .limit(50);
      return dividendDtos(app.db, rows, listing);
    },
  );

  app.post(
    '/organizations/:id/dividends',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Pay every current shareholder the same amount per share from a company balance in the listing ' +
          'currency. At or above the approval limit it waits for a second signature (202, "pending").',
        params: z.object({ id: z.uuid() }),
        body: dividendInputSchema,
        response: { 201: dividendSchema, 202: dividendSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await requireManager(req.params.id, me);
      const listing = await listingOfOrg(req.params.id);
      const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, req.body.walletId));
      if (!wallet || wallet.organizationId !== req.params.id) throw notFound('Company balance');
      if (wallet.currency !== listing.currency) throw badRequest(`Pay from the ${listing.currency} balance`);
      await assertWalletAccess(app.db, wallet, me, true);
      const perShare = parseAmount(req.body.perShare, listing.currency);
      if (perShare <= 0n) throw badRequest('The amount per share must be positive');

      const outcome = await app.db.transaction(async (tx) => {
        const recipients = await holders(tx, listing.id);
        if (!recipients.length) throw conflict('Nobody holds shares yet');
        const shares = recipients.reduce((n, r) => n + r.shares, 0n);
        const total = shares * perShare;
        const [row] = await tx
          .insert(dividends)
          .values({
            listingId: listing.id,
            walletId: wallet.id,
            perShare,
            shares,
            holders: recipients.length,
            total,
            note: req.body.note ?? '',
            status: 'pending',
            recipients: recipients.map((r) => ({ userId: r.userId, shares: r.shares.toString() })),
            createdBy: me.id,
          })
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: 'dividend.declare',
          targetType: 'organization',
          targetId: req.params.id,
          data: {
            perShare: req.body.perShare,
            total: formatAmount(total, listing.currency),
            holders: recipients.length,
          },
          ip: req.ip,
        });
        if (await needsSecondSignature(tx, wallet, total)) {
          const approval = await requestSecondSignature(tx, {
            wallet,
            kind: 'dividend',
            action: { dividendId: row!.id },
            amount: total,
            description: `Dividend ${listing.ticker}: ${req.body.perShare} ${listing.currency} a share to ${recipients.length} shareholders`,
            requestedBy: me.id,
            ip: req.ip,
          });
          await tx.update(dividends).set({ approvalId: approval.id }).where(eq(dividends.id, row!.id));
          return { id: row!.id, approval };
        }
        return { id: row!.id, paid: await executeDividend(tx, row!, listing, me.id) };
      });
      const [row] = await app.db.select().from(dividends).where(eq(dividends.id, outcome.id));
      const [dto] = await dividendDtos(app.db, [row!], listing);
      if (outcome.approval) {
        await announceApproval(app, outcome.approval);
        return reply.status(202).send(dto!);
      }
      app.hub.sendToUsers(await walletAudience(app.db, wallet), {
        type: 'wallet.updated',
        walletId: wallet.id,
      });
      for (const w of outcome.paid!)
        app.hub.sendToUsers([w.userId!], { type: 'wallet.updated', walletId: w.id });
      await notifyHolders(listing);
      return reply.status(201).send(dto!);
    },
  );

  // ----- Shareholder votes --------------------------------------------------------------

  app.get(
    '/stock/listings/:ticker/proposals',
    {
      preHandler: app.optionalAuth,
      schema: {
        tags,
        security: [{}, { bearerAuth: [] }],
        description: 'Shareholder votes, newest first, with their tallies (in shares).',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        response: { 200: z.array(proposalSchema) },
      },
    },
    async (req) => {
      const listing = await listingByTicker(req.params.ticker);
      const rows = await app.db
        .select()
        .from(proposals)
        .where(eq(proposals.listingId, listing.id))
        .orderBy(desc(proposals.createdAt))
        .limit(50);
      return proposalDtos(app.db, rows, req.user?.id);
    },
  );

  app.post(
    '/organizations/:id/proposals',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Put a question to the shareholders. Everyone holding shares now may vote once, weighted by the ' +
          'shares they hold now (buying more later does not add votes).',
        params: z.object({ id: z.uuid() }),
        body: createProposalSchema,
        response: { 201: proposalSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await requireManager(req.params.id, me);
      const listing = await listingOfOrg(req.params.id);
      const closesAt = new Date(req.body.closesAt);
      if (closesAt.getTime() < Date.now() + 3_600_000)
        throw badRequest('Voting must stay open for at least an hour');
      if (closesAt.getTime() > Date.now() + 90 * 86_400_000)
        throw badRequest('Voting can last at most 90 days');
      const labels = req.body.options ?? DEFAULT_OPTIONS;
      if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length)
        throw badRequest('The options must be different');
      const id = await app.db.transaction(async (tx) => {
        const voters = await holders(tx, listing.id);
        if (!voters.length) throw conflict('Nobody holds shares yet');
        const [row] = await tx
          .insert(proposals)
          .values({
            listingId: listing.id,
            title: req.body.title,
            description: req.body.description,
            options: labels.map((label, i) => ({ key: `o${i + 1}`, label })),
            closesAt,
            totalShares: voters.reduce((n, v) => n + v.shares, 0n),
            createdBy: me.id,
          })
          .returning();
        await tx
          .insert(proposalVoters)
          .values(voters.map((v) => ({ proposalId: row!.id, userId: v.userId, shares: v.shares })));
        await audit(tx, {
          actorId: me.id,
          action: 'proposal.create',
          targetType: 'organization',
          targetId: req.params.id,
          data: { title: req.body.title },
          ip: req.ip,
        });
        return row!.id;
      });
      await notifyHolders(listing);
      const [row] = await app.db.select().from(proposals).where(eq(proposals.id, id));
      return reply.status(201).send((await proposalDtos(app.db, [row!], me.id))[0]!);
    },
  );

  app.post(
    '/stock/proposals/:id/vote',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Vote once, with the shares you held when the vote opened.',
        params: z.object({ id: z.uuid() }),
        body: castVoteSchema,
        response: { 200: proposalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const [proposal] = await app.db.select().from(proposals).where(eq(proposals.id, req.params.id));
      if (!proposal) throw notFound('Vote');
      if (!proposalOpen(proposal)) throw conflict('This vote is closed');
      if (!proposal.options.some((o) => o.key === req.body.option)) throw badRequest('Unknown option');
      const [voted] = await app.db
        .update(proposalVoters)
        .set({ option: req.body.option, votedAt: new Date() })
        .where(
          and(
            eq(proposalVoters.proposalId, proposal.id),
            eq(proposalVoters.userId, me.id),
            sql`${proposalVoters.option} is null`,
          ),
        )
        .returning();
      if (!voted) {
        const [eligible] = await app.db
          .select()
          .from(proposalVoters)
          .where(and(eq(proposalVoters.proposalId, proposal.id), eq(proposalVoters.userId, me.id)));
        throw eligible
          ? conflict('You have already voted')
          : forbidden('Only people who held shares when the vote opened can vote');
      }
      const [listing] = await app.db
        .select()
        .from(stockListings)
        .where(eq(stockListings.id, proposal.listingId));
      app.hub.broadcast({ type: 'stock.updated', ticker: listing!.ticker });
      return (await proposalDtos(app.db, [proposal], me.id))[0]!;
    },
  );

  app.post(
    '/organizations/:id/proposals/:pid/close',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Close a vote before its end time.',
        params: z.object({ id: z.uuid(), pid: z.uuid() }),
        response: { 200: proposalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      await requireManager(req.params.id, me);
      const listing = await listingOfOrg(req.params.id);
      const [row] = await app.db
        .update(proposals)
        .set({ closedEarlyAt: new Date() })
        .where(
          and(
            eq(proposals.id, req.params.pid),
            eq(proposals.listingId, listing.id),
            sql`${proposals.closedEarlyAt} is null`,
            gt(proposals.closesAt, new Date()),
          ),
        )
        .returning();
      if (!row) throw conflict('This vote is already closed');
      return (await proposalDtos(app.db, [row], me.id))[0]!;
    },
  );

  // ----- Company reports ----------------------------------------------------------------

  app.get(
    '/stock/listings/:ticker/reports',
    {
      schema: {
        tags,
        security: [],
        description: 'Results the company published, newest first.',
        params: z.object({ ticker: z.string().min(1).max(8) }),
        response: { 200: z.array(companyReportSchema) },
      },
    },
    async (req) => {
      const listing = await listingByTicker(req.params.ticker);
      const rows = await app.db
        .select()
        .from(companyReports)
        .where(eq(companyReports.organizationId, listing.organizationId))
        .orderBy(desc(companyReports.publishedAt))
        .limit(40);
      return reportDtos(app, rows);
    },
  );

  app.post(
    '/organizations/:id/reports',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Publish results (e.g. a quarter) on the listing page: text, revenue and profit in the listing ' +
          'currency, and documents uploaded with POST /files.',
        params: z.object({ id: z.uuid() }),
        body: createReportSchema,
        response: { 201: companyReportSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      await requireManager(req.params.id, me);
      const listing = await listingOfOrg(req.params.id);
      const input = req.body;
      const id = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(companyReports)
          .values({
            organizationId: req.params.id,
            period: input.period,
            title: input.title,
            body: input.body,
            currency: listing.currency,
            revenue: input.revenue ? signed(input.revenue, listing.currency) : null,
            profit: input.profit ? signed(input.profit, listing.currency) : null,
            authorId: me.id,
          })
          .returning();
        await attachFiles(tx, me.id, input.attachments ?? [], 'report', row!.id);
        await audit(tx, {
          actorId: me.id,
          action: 'report.publish',
          targetType: 'organization',
          targetId: req.params.id,
          data: { period: input.period, title: input.title },
          ip: req.ip,
        });
        return row!.id;
      });
      await notifyHolders(listing);
      const [row] = await app.db.select().from(companyReports).where(eq(companyReports.id, id));
      return reply.status(201).send((await reportDtos(app, [row!]))[0]!);
    },
  );
}
