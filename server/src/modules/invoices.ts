import {
  cancelInvoiceSchema,
  createInvoiceSchema,
  formatAmount,
  invoiceQuerySchema,
  invoiceSchema,
  ORG_FINANCE_ROLES,
  parseAmount,
  payInvoiceSchema,
  paymentApprovalSchema,
  type CreateInvoiceInput,
  type Invoice,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  invoicePayments,
  invoices,
  invoiceSchedules,
  organizationMembers,
  organizations,
  users,
  wallets,
} from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import {
  announceApproval,
  approvalDto,
  dropPendingApprovals,
  needsSecondSignature,
  pendingApprovalFor,
  requestSecondSignature,
} from './org-payments';
import { walletAudience } from './wallets/routes';
import {
  assertWalletAccess,
  getOrCreateWallet,
  transfer,
  walletOwnerId,
  type WalletRow,
} from './wallets/service';
import { queueNotification } from '../lib/notify';

export type InvoiceRow = typeof invoices.$inferSelect;
export type Party = { type: 'user' | 'organization'; id: string };

/** Largest invoice total (fits the bigint money column with room to spare). */
const MAX_TOTAL = 10n ** 17n;

export const issuerOf = (r: Pick<InvoiceRow, 'issuerType' | 'issuerUserId' | 'issuerOrgId'>): Party =>
  r.issuerType === 'user'
    ? { type: 'user', id: r.issuerUserId! }
    : { type: 'organization', id: r.issuerOrgId! };
export const recipientOf = (
  r: Pick<InvoiceRow, 'recipientType' | 'recipientUserId' | 'recipientOrgId'>,
): Party =>
  r.recipientType === 'user'
    ? { type: 'user', id: r.recipientUserId! }
    : { type: 'organization', id: r.recipientOrgId! };

export const today = () => new Date().toISOString().slice(0, 10);

/** Companies where the user may move money: owners, directors and accountants. */
export async function financeOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      and(eq(organizationMembers.userId, userId), inArray(organizationMembers.role, [...ORG_FINANCE_ROLES])),
    );
  return rows.map((r) => r.id);
}

export const actsFor = (party: Party, userId: string, orgIds: string[]) =>
  party.type === 'user' ? party.id === userId : orgIds.includes(party.id);

/** Everyone who hears about an invoice on one side: the person, or the company's finance team. */
export async function partyAudience(db: Db, party: Party): Promise<string[]> {
  if (party.type === 'user') return [party.id];
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, party.id),
        inArray(organizationMembers.role, [...ORG_FINANCE_ROLES]),
      ),
    );
  return rows.map((r) => r.userId);
}

export async function invoiceDtos(
  db: Db,
  rows: InvoiceRow[],
  viewerId: string,
  orgIds: string[],
): Promise<Invoice[]> {
  if (rows.length === 0) return [];
  const userIds = new Set<string>();
  const orgs = new Set<string>();
  for (const r of rows) {
    for (const p of [issuerOf(r), recipientOf(r)]) (p.type === 'user' ? userIds : orgs).add(p.id);
    userIds.add(r.createdBy);
    if (r.paidBy) userIds.add(r.paidBy);
  }
  const scheduleIds = [...new Set(rows.flatMap((r) => (r.scheduleId ? [r.scheduleId] : [])))];
  const [payments, schedules] = await Promise.all([
    db
      .select()
      .from(invoicePayments)
      .where(
        inArray(
          invoicePayments.invoiceId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(invoicePayments.createdAt),
    scheduleIds.length
      ? db
          .select({ id: invoiceSchedules.id, interval: invoiceSchedules.interval })
          .from(invoiceSchedules)
          .where(inArray(invoiceSchedules.id, scheduleIds))
      : Promise.resolve([]),
  ]);
  for (const p of payments) userIds.add(p.paidBy);
  const intervalOf = new Map(schedules.map((s) => [s.id, s.interval]));
  const [people, companies] = await Promise.all([
    db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...userIds])),
    orgs.size
      ? db
          .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
          .from(organizations)
          .where(inArray(organizations.id, [...orgs]))
      : Promise.resolve([]),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const company = new Map(companies.map((c) => [c.id, c]));
  const party = (p: Party) =>
    p.type === 'user'
      ? { ...p, name: person.get(p.id)?.displayName ?? '', handle: `@${person.get(p.id)?.username ?? ''}` }
      : { ...p, name: company.get(p.id)?.name ?? '', handle: company.get(p.id)?.slug ?? '' };
  const ref = (id: string) => {
    const p = person.get(id);
    return { id, username: p?.username ?? '', displayName: p?.displayName ?? '' };
  };
  const now = today();
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    direction: actsFor(issuerOf(r), viewerId, orgIds) ? 'outgoing' : 'incoming',
    issuer: party(issuerOf(r)),
    recipient: party(recipientOf(r)),
    currency: r.currency,
    items: r.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: formatAmount(i.unitPrice, r.currency),
      amount: formatAmount(BigInt(i.unitPrice) * BigInt(i.quantity), r.currency),
    })),
    total: formatAmount(r.total, r.currency),
    amountPaid: formatAmount(r.amountPaid, r.currency),
    amountDue: formatAmount(r.status === 'open' ? r.total - r.amountPaid : 0n, r.currency),
    payments: payments
      .filter((p) => p.invoiceId === r.id)
      .map((p) => ({
        id: p.id,
        amount: formatAmount(p.amount, r.currency),
        paidBy: ref(p.paidBy),
        createdAt: iso(p.createdAt),
      })),
    note: r.note,
    dueDate: r.dueDate,
    status: r.status,
    overdue: r.status === 'open' && r.dueDate < now,
    recurring:
      r.scheduleId && intervalOf.has(r.scheduleId)
        ? { scheduleId: r.scheduleId, interval: intervalOf.get(r.scheduleId)! }
        : null,
    createdBy: ref(r.createdBy),
    createdAt: iso(r.createdAt),
    paidAt: isoOrNull(r.paidAt),
    paidBy: r.paidBy ? ref(r.paidBy) : null,
    cancelledAt: isoOrNull(r.cancelledAt),
    cancelReason: r.cancelReason,
  }));
}

/** Names and handles for people and companies on invoices. */
export async function describeParties(db: Db, parties: Party[]) {
  const userIds = [...new Set(parties.filter((p) => p.type === 'user').map((p) => p.id))];
  const orgIds = [...new Set(parties.filter((p) => p.type === 'organization').map((p) => p.id))];
  const [people, companies] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    orgIds.length
      ? db
          .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
          .from(organizations)
          .where(inArray(organizations.id, orgIds))
      : Promise.resolve([]),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const company = new Map(companies.map((c) => [c.id, c]));
  return (p: Party) =>
    p.type === 'user'
      ? { ...p, name: person.get(p.id)?.displayName ?? '', handle: `@${person.get(p.id)?.username ?? ''}` }
      : { ...p, name: company.get(p.id)?.name ?? '', handle: company.get(p.id)?.slug ?? '' };
}

/** Invoices a person can see: their own and those of companies where they handle money. */
function visibleTo(userId: string, orgIds: string[], direction?: 'incoming' | 'outgoing'): SQL {
  const side = (userCol: PgColumn, orgCol: PgColumn) =>
    or(eq(userCol, userId), orgIds.length ? inArray(orgCol, orgIds) : sql`false`)!;
  const incoming = side(invoices.recipientUserId, invoices.recipientOrgId);
  const outgoing = side(invoices.issuerUserId, invoices.issuerOrgId);
  if (direction === 'incoming') return incoming;
  if (direction === 'outgoing') return outgoing;
  return or(incoming, outgoing)!;
}

/** Tell both sides that an invoice changed (and the side it concerns, in their notifications). */
export async function announceInvoice(
  app: FastifyInstance,
  row: InvoiceRow,
  event?: 'issued' | 'paid' | 'cancelled',
) {
  const issuers = await partyAudience(app.db, issuerOf(row));
  const recipients = await partyAudience(app.db, recipientOf(row));
  app.hub.sendToUsers([...issuers, ...recipients], {
    type: 'invoice.updated',
    invoiceId: row.id,
    status: row.status,
  });
  if (!event) return;
  const [view] = await invoiceDtos(app.db, [row], row.issuerUserId ?? '', []);
  const total = `${formatAmount(row.total, row.currency)} ${row.currency}`;
  if (event === 'issued')
    await queueNotification(app.db, recipients, {
      type: 'invoice',
      title: `Invoice ${row.number} from ${view!.issuer.name}: ${total}`,
      body: row.dueDate ? `Due ${row.dueDate}` : 'Pay it from Invoices.',
      link: '/invoices',
    });
  else if (event === 'paid')
    await queueNotification(app.db, issuers, {
      type: 'invoice',
      title:
        row.status === 'paid'
          ? `Invoice ${row.number} was paid: ${total}`
          : `Invoice ${row.number}: ${formatAmount(row.amountPaid, row.currency)} of ${total} paid`,
      body: `By ${view!.recipient.name}`,
      link: '/invoices',
    });
  else
    await queueNotification(app.db, recipients, {
      type: 'invoice',
      title: `Invoice ${row.number} from ${view!.issuer.name} was cancelled`,
      body: total,
      link: '/invoices',
    });
}

/** Lock an open invoice and check that `wallet` may pay it and its issuer can be paid. */
async function checkPayable(tx: Db, invoiceId: string, wallet: WalletRow): Promise<InvoiceRow> {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!invoice) throw notFound('Invoice');
  if (invoice.status !== 'open') throw conflict(`This invoice is already ${invoice.status}`);
  const payer = recipientOf(invoice);
  if (wallet.ownerType !== payer.type || walletOwnerId(wallet) !== payer.id)
    throw badRequest('Pay from a balance of the invoice recipient');
  if (wallet.currency !== invoice.currency) throw badRequest(`Pay from a ${invoice.currency} balance`);
  const issuer = issuerOf(invoice);
  const [active] =
    issuer.type === 'user'
      ? await tx.select({ status: users.status }).from(users).where(eq(users.id, issuer.id))
      : await tx
          .select({ status: organizations.status })
          .from(organizations)
          .where(eq(organizations.id, issuer.id));
  if (active?.status !== 'active') throw conflict('The issuer is suspended; this invoice cannot be paid now');
  return invoice;
}

/** Pay an invoice from `wallet`; call inside a transaction (access is checked by the caller). */
export async function executeInvoicePayment(
  tx: Db,
  input: { invoiceId: string; wallet: WalletRow; amount: bigint; actorId: string },
) {
  const invoice = await checkPayable(tx, input.invoiceId, input.wallet);
  const due = invoice.total - invoice.amountPaid;
  if (input.amount <= 0n) throw badRequest('Amount must be positive');
  if (input.amount > due)
    throw conflict(`Only ${formatAmount(due, invoice.currency)} ${invoice.currency} is still due`);
  const full = input.amount === due;
  const [view] = await invoiceDtos(tx, [invoice], input.actorId, []);
  const target = await getOrCreateWallet(tx, issuerOf(invoice), invoice.currency);
  const part = full && invoice.amountPaid === 0n ? '' : full ? ' (final part)' : ' (part)';
  await transfer(
    tx,
    input.wallet.id,
    target.id,
    input.amount,
    { out: 'transfer_out', in: 'transfer_in' },
    {
      description: `Invoice ${invoice.number} from ${view!.issuer.name}${part}`,
      actorId: input.actorId,
      referenceType: 'invoice',
      referenceId: invoice.id,
    },
    `Invoice ${invoice.number} paid by ${view!.recipient.name}${part}`,
  );
  await tx.insert(invoicePayments).values({
    invoiceId: invoice.id,
    walletId: input.wallet.id,
    amount: input.amount,
    paidBy: input.actorId,
  });
  const [paid] = await tx
    .update(invoices)
    .set({
      amountPaid: invoice.amountPaid + input.amount,
      ...(full
        ? {
            status: 'paid' as const,
            paidAt: new Date(),
            paidBy: input.actorId,
            paidFromWalletId: input.wallet.id,
          }
        : {}),
    })
    .where(eq(invoices.id, invoice.id))
    .returning();
  return { invoice: paid!, target };
}

/** Who sends and who receives an invoice (or a recurring one), checked for `userId`. */
export async function resolveParties(
  db: Db,
  userId: string,
  input: Pick<CreateInvoiceInput, 'from' | 'to'>,
): Promise<{ issuer: Party; recipient: Party }> {
  let issuer: Party = { type: 'user', id: userId };
  if (input.from.type === 'organization') {
    const orgIds = await financeOrgIds(db, userId);
    if (!orgIds.includes(input.from.organizationId))
      throw forbidden('Only owners, directors and accountants can invoice for this company');
    const [org] = await db
      .select({ status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, input.from.organizationId));
    if (org?.status !== 'active') throw badRequest('This company is not active');
    issuer = { type: 'organization', id: input.from.organizationId };
  }
  let recipient: Party;
  if (input.to.type === 'user') {
    const [user] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.username, input.to.username));
    if (!user || user.status !== 'active') throw notFound('Recipient');
    recipient = { type: 'user', id: user.id };
  } else {
    const [org] = await db
      .select({ id: organizations.id, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.slug, input.to.slug));
    if (!org || org.status !== 'active') throw notFound('Recipient company');
    recipient = { type: 'organization', id: org.id };
  }
  if (issuer.type === recipient.type && issuer.id === recipient.id)
    throw badRequest('An invoice needs a different recipient');
  return { issuer, recipient };
}

/** Invoice lines in minor units, and their total. */
export function invoiceLines(lines: CreateInvoiceInput['items'], currency: string) {
  const items = lines.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    unitPrice: parseAmount(i.unitPrice, currency).toString(),
  }));
  const total = items.reduce((sum, i) => sum + BigInt(i.unitPrice) * BigInt(i.quantity), 0n);
  if (total <= 0n) throw badRequest('The total must be more than zero');
  if (total > MAX_TOTAL) throw badRequest('The total is too large');
  return { items, total };
}

/** Number and store a new invoice; call inside a transaction, then `announceInvoice`. */
export async function issueInvoice(
  tx: Db,
  input: {
    issuer: Party;
    recipient: Party;
    currency: string;
    items: InvoiceRow['items'];
    total: bigint;
    note: string;
    dueDate: string;
    createdBy: string;
    scheduleId?: string;
  },
): Promise<InvoiceRow> {
  const { issuer, recipient } = input;
  // Numbers are sequential per issuer and year; serialise numbering for this issuer.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${issuer.id}, 0))`);
  const prefix = `INV-${new Date().getUTCFullYear()}-`;
  const [issued] = await tx
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        issuer.type === 'user' ? eq(invoices.issuerUserId, issuer.id) : eq(invoices.issuerOrgId, issuer.id),
        like(invoices.number, `${prefix}%`),
      ),
    );
  const [created] = await tx
    .insert(invoices)
    .values({
      number: `${prefix}${String((issued?.n ?? 0) + 1).padStart(4, '0')}`,
      issuerType: issuer.type,
      issuerUserId: issuer.type === 'user' ? issuer.id : null,
      issuerOrgId: issuer.type === 'organization' ? issuer.id : null,
      recipientType: recipient.type,
      recipientUserId: recipient.type === 'user' ? recipient.id : null,
      recipientOrgId: recipient.type === 'organization' ? recipient.id : null,
      currency: input.currency,
      items: input.items,
      total: input.total,
      note: input.note,
      dueDate: input.dueDate,
      createdBy: input.createdBy,
      scheduleId: input.scheduleId ?? null,
    })
    .returning();
  return created!;
}

export async function invoiceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['invoices'];
  app.addHook('preHandler', app.authenticate);

  const load = async (id: string, userId: string) => {
    const orgIds = await financeOrgIds(app.db, userId);
    const [row] = await app.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), visibleTo(userId, orgIds)));
    if (!row) throw notFound('Invoice');
    return { row, orgIds };
  };

  const dto = async (id: string, userId: string) => {
    const { row, orgIds } = await load(id, userId);
    const [invoice] = await invoiceDtos(app.db, [row], userId, orgIds);
    return invoice!;
  };

  app.get(
    '/invoices',
    {
      schema: {
        tags,
        description: 'Invoices you sent or received, personally or for your companies. Newest first.',
        querystring: invoiceQuerySchema,
        response: { 200: z.array(invoiceSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const orgIds = await financeOrgIds(app.db, me.id);
      const rows = await app.db
        .select()
        .from(invoices)
        .where(
          and(
            visibleTo(me.id, orgIds, req.query.direction),
            req.query.status ? eq(invoices.status, req.query.status) : undefined,
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(200);
      return invoiceDtos(app.db, rows, me.id, orgIds);
    },
  );

  app.get(
    '/invoices/:id',
    { schema: { tags, params: z.object({ id: z.uuid() }), response: { 200: invoiceSchema } } },
    async (req) => dto(req.params.id, currentUser(req).id),
  );

  app.post(
    '/invoices',
    {
      schema: {
        tags,
        description: 'Invoice a person or a company. The number is assigned per issuer and year.',
        body: createInvoiceSchema,
        response: { 201: invoiceSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const input = req.body;
      const { issuer, recipient } = await resolveParties(app.db, me.id, input);
      if (input.dueDate < today()) throw badRequest('The due date is in the past');
      const { items, total } = invoiceLines(input.items, input.currency);
      const row = await app.db.transaction((tx) =>
        issueInvoice(tx, {
          issuer,
          recipient,
          currency: input.currency,
          items,
          total,
          note: input.note ?? '',
          dueDate: input.dueDate,
          createdBy: me.id,
        }),
      );
      await announceInvoice(app, row, 'issued');
      return reply.status(201).send(await dto(row.id, me.id));
    },
  );

  app.post(
    '/invoices/:id/pay',
    {
      schema: {
        tags,
        description:
          "Pay the invoice from one of the recipient's balances in its currency: everything still due, or " +
          'a part of it. Company payments of at least the approval limit wait for a second finance member (202).',
        params: z.object({ id: z.uuid() }),
        body: payInvoiceSchema,
        response: { 200: invoiceSchema, 202: paymentApprovalSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const { row } = await load(req.params.id, me.id);
      const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, req.body.walletId));
      if (!wallet) throw notFound('Wallet');
      await assertWalletAccess(app.db, wallet, me, true);
      const outcome = await app.db.transaction(async (tx) => {
        const due = row.total - row.amountPaid;
        const amount = req.body.amount ? parseAmount(req.body.amount, row.currency) : due;
        if (amount > due)
          throw conflict(`Only ${formatAmount(due, row.currency)} ${row.currency} is still due`);
        if (await needsSecondSignature(tx, wallet, amount)) {
          const invoice = await checkPayable(tx, row.id, wallet);
          if (await pendingApprovalFor(tx, 'invoice', 'invoiceId', invoice.id))
            throw conflict('A payment of this invoice is already waiting for approval');
          const [view] = await invoiceDtos(tx, [invoice], me.id, []);
          const approval = await requestSecondSignature(tx, {
            wallet,
            kind: 'invoice',
            action: { invoiceId: invoice.id },
            amount,
            description: `Invoice ${invoice.number} from ${view!.issuer.name}${amount < due ? ` (part: ${formatAmount(amount, invoice.currency)} of ${formatAmount(due, invoice.currency)} ${invoice.currency} due)` : ''}`,
            requestedBy: me.id,
            ip: req.ip,
          });
          return { approval };
        }
        return {
          paid: await executeInvoicePayment(tx, { invoiceId: row.id, wallet, amount, actorId: me.id }),
        };
      });
      if (outcome.approval) {
        await announceApproval(app, outcome.approval);
        return reply.status(202).send(await approvalDto(app, outcome.approval));
      }
      const { invoice, target } = outcome.paid!;
      await announceInvoice(app, invoice, 'paid');
      for (const w of [wallet, target]) {
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      }
      return dto(row.id, me.id);
    },
  );

  app.post(
    '/invoices/:id/cancel',
    {
      schema: {
        tags,
        description: 'Withdraw an unpaid invoice (issuer only).',
        params: z.object({ id: z.uuid() }),
        body: cancelInvoiceSchema,
        response: { 200: invoiceSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { row, orgIds } = await load(req.params.id, me.id);
      if (!actsFor(issuerOf(row), me.id, orgIds)) throw forbidden('Only the issuer can cancel an invoice');
      const { cancelled, dropped } = await app.db.transaction(async (tx) => {
        if (row.amountPaid > 0n)
          throw conflict('Part of this invoice is already paid, so it cannot be cancelled any more');
        const [cancelled] = await tx
          .update(invoices)
          .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: req.body.reason || null })
          .where(and(eq(invoices.id, row.id), eq(invoices.status, 'open'), eq(invoices.amountPaid, 0n)))
          .returning();
        if (!cancelled) throw conflict('This invoice is no longer open');
        const dropped = await dropPendingApprovals(
          tx,
          'invoice',
          'invoiceId',
          row.id,
          'The invoice was cancelled',
        );
        return { cancelled, dropped };
      });
      await announceInvoice(app, cancelled, 'cancelled');
      for (const approval of dropped) await announceApproval(app, approval);
      return dto(row.id, me.id);
    },
  );
}
