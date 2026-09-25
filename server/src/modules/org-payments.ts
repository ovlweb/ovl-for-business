import {
  can,
  formatAmount,
  ORG_FINANCE_ROLES,
  PAYMENT_APPROVAL_KINDS,
  paymentApprovalSchema,
  type PaymentApproval,
  type TransferInput,
} from '@ovl/shared';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  fundLocks,
  organizationMembers,
  organizations,
  paymentApprovals,
  users,
  wallets,
} from '../db/schema';
import { audit } from '../lib/audit';
import { conflict, forbidden, insufficientFunds, notFound } from '../lib/errors';
import { convert, loadRateTable } from '../lib/fx';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { executeExchange } from './exchange';
import { announceInvoice, executeInvoicePayment, type InvoiceRow } from './invoices';
import { approvePayrollRun, releasePayrollRun } from './payroll';
import { approveDividend, releaseDividend } from './stock/shareholders';
import { executeTransfer, walletAudience } from './wallets/routes';
import { assertWalletAccess, frozenAmounts, lockWallet, orgRoleOf, type WalletRow } from './wallets/service';
import { queueNotification } from '../lib/notify';
import { text } from '../lib/i18n';

/** Money of a payment waiting for its second signature is set aside until someone decides. */
const APPROVAL_HOLD = 'payment_approval';
const HOLD_UNTIL = new Date('2100-01-01T00:00:00Z');

export type ApprovalRow = typeof paymentApprovals.$inferSelect;
type Kind = (typeof PAYMENT_APPROVAL_KINDS)[number];

/** What each kind of payment remembers until it is approved. */
export interface ApprovalActions {
  transfer: { to: TransferInput['to']; note?: string };
  invoice: { invoiceId: string };
  exchange: { toCurrency: string };
  payroll: { payrollRunId: string };
  dividend: { dividendId: string };
}

/**
 * Does this payment need a second signature? Only company balances whose owners set an approval
 * limit; the amount is compared in the company's base currency. Without an exchange rate to
 * compare with, the safe answer is yes.
 */
export async function needsSecondSignature(db: Db, wallet: WalletRow, amount: bigint): Promise<boolean> {
  if (wallet.ownerType !== 'organization') return false;
  const [org] = await db
    .select({ limit: organizations.approvalLimit, base: organizations.baseCurrency })
    .from(organizations)
    .where(eq(organizations.id, wallet.organizationId!));
  if (!org || org.limit === null) return false;
  if (wallet.currency === org.base) return amount >= org.limit;
  const inBase = convert(amount, wallet.currency, org.base, await loadRateTable(db));
  return inBase === null || inBase >= org.limit;
}

export async function requestSecondSignature<K extends Kind>(
  tx: Db,
  input: {
    wallet: WalletRow;
    kind: K;
    action: ApprovalActions[K];
    amount: bigint;
    description: string;
    requestedBy: string;
    ip?: string;
  },
): Promise<ApprovalRow> {
  const wallet = await lockWallet(tx, input.wallet.id);
  const frozen = (await frozenAmounts(tx, [wallet.id])).get(wallet.id) ?? 0n;
  if (wallet.balance - frozen < input.amount)
    throw insufficientFunds(
      text`Only ${formatAmount(wallet.balance - frozen, wallet.currency)} ${wallet.currency} is available`,
    );
  const [row] = await tx
    .insert(paymentApprovals)
    .values({
      organizationId: wallet.organizationId!,
      walletId: wallet.id,
      kind: input.kind,
      action: input.action as unknown as Record<string, unknown>,
      amount: input.amount,
      currency: wallet.currency,
      description: input.description,
      requestedBy: input.requestedBy,
    })
    .returning();
  await tx.insert(fundLocks).values({
    walletId: wallet.id,
    amount: input.amount,
    reason: APPROVAL_HOLD,
    referenceId: row!.id,
    unlocksAt: HOLD_UNTIL,
  });
  await audit(tx, {
    actorId: input.requestedBy,
    action: 'payment.approval_requested',
    targetType: 'organization',
    targetId: wallet.organizationId!,
    data: {
      kind: input.kind,
      amount: formatAmount(input.amount, wallet.currency),
      currency: wallet.currency,
    },
    ip: input.ip,
  });
  return row!;
}

/** Whether something (an invoice, a payroll run) already waits for a second signature. */
export async function pendingApprovalFor(db: Db, kind: Kind, key: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: paymentApprovals.id })
    .from(paymentApprovals)
    .where(
      and(
        eq(paymentApprovals.kind, kind),
        eq(paymentApprovals.status, 'pending'),
        sql`${paymentApprovals.action} ->> ${key} = ${id}`,
      ),
    );
  return !!row;
}

/** Drop the waiting approvals of something that went away (a cancelled invoice). */
export async function dropPendingApprovals(tx: Db, kind: Kind, key: string, id: string, reason: string) {
  const dropped = await tx
    .update(paymentApprovals)
    .set({ status: 'rejected', reason, decidedAt: new Date() })
    .where(
      and(
        eq(paymentApprovals.kind, kind),
        eq(paymentApprovals.status, 'pending'),
        sql`${paymentApprovals.action} ->> ${key} = ${id}`,
      ),
    )
    .returning();
  if (dropped.length)
    await tx.delete(fundLocks).where(
      and(
        eq(fundLocks.reason, APPROVAL_HOLD),
        inArray(
          fundLocks.referenceId,
          dropped.map((d) => d.id),
        ),
      ),
    );
  return dropped;
}

const requester = alias(users, 'payment_requester');
const decider = alias(users, 'payment_decider');

export async function paymentApprovalDtos(db: Db, where?: SQL, limit = 100): Promise<PaymentApproval[]> {
  const rows = await db
    .select({
      a: paymentApprovals,
      requester: { id: requester.id, username: requester.username, displayName: requester.displayName },
      decider: { id: decider.id, username: decider.username, displayName: decider.displayName },
    })
    .from(paymentApprovals)
    .innerJoin(requester, eq(requester.id, paymentApprovals.requestedBy))
    .leftJoin(decider, eq(decider.id, paymentApprovals.decidedBy))
    .where(where)
    .orderBy(desc(paymentApprovals.createdAt))
    .limit(limit);
  return rows.map(({ a, requester, decider }) => ({
    id: a.id,
    organizationId: a.organizationId,
    walletId: a.walletId,
    kind: a.kind,
    amount: formatAmount(a.amount, a.currency),
    currency: a.currency,
    description: a.description,
    status: a.status,
    requestedBy: requester,
    decidedBy: decider?.id ? decider : null,
    reason: a.reason,
    createdAt: iso(a.createdAt),
    decidedAt: isoOrNull(a.decidedAt),
  }));
}

export async function approvalDto(app: FastifyInstance, row: ApprovalRow): Promise<PaymentApproval> {
  const [dto] = await paymentApprovalDtos(app.db, eq(paymentApprovals.id, row.id), 1);
  return dto!;
}

/** Tell the company's finance team that an approval changed (and its balance with it). */
export async function announceApproval(app: FastifyInstance, row: ApprovalRow) {
  const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, row.walletId));
  if (!wallet) return;
  const audience = await walletAudience(app.db, wallet);
  const [org] = await app.db
    .select({ name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, row.organizationId));
  const amount = `${formatAmount(row.amount, row.currency)} ${row.currency}`;
  const link = org ? `/companies/${org.slug}` : '/companies';
  if (row.status === 'pending')
    await queueNotification(
      app.db,
      audience.filter((id) => id !== row.requestedBy),
      {
        type: 'payment_approval',
        title: org
          ? text`${org.name} payment needs your signature: ${amount}`
          : text`A company payment needs your signature: ${amount}`,
        body: row.description,
        link,
      },
    );
  else
    await queueNotification(app.db, [row.requestedBy], {
      type: 'payment_approval',
      title:
        row.status === 'approved'
          ? text`Approved: ${amount} from ${org?.name ?? ''}`
          : text`Not approved: ${amount} from ${org?.name ?? ''}`,
      body: row.reason ? `${row.description} — ${row.reason}` : row.description,
      link,
    });
  app.hub.sendToUsers(audience, {
    type: 'payment_approval.updated',
    organizationId: row.organizationId,
    approvalId: row.id,
    status: row.status,
  });
  if (row.kind === 'payroll')
    app.hub.sendToUsers(audience, {
      type: 'payroll.updated',
      organizationId: row.organizationId,
      runId: (row.action as unknown as ApprovalActions['payroll']).payrollRunId,
      status: row.status === 'approved' ? 'paid' : row.status === 'rejected' ? 'rejected' : 'pending',
    });
  app.hub.sendToUsers(audience, { type: 'wallet.updated', walletId: wallet.id });
}

export async function pendingPaymentApprovals(db: Db, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(paymentApprovals)
    .where(and(eq(paymentApprovals.organizationId, organizationId), eq(paymentApprovals.status, 'pending')));
  return row?.n ?? 0;
}

/** Owners, directors and accountants: the people who can sign company payments. */
export async function financeMemberCount(db: Db, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.role, [...ORG_FINANCE_ROLES]),
      ),
    );
  return row?.n ?? 0;
}

export async function orgPaymentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['organizations'];
  app.addHook('preHandler', app.authenticate);

  const params = z.object({ id: z.uuid(), aid: z.uuid() });
  const lock = async (tx: Db, organizationId: string, id: string) => {
    const [row] = await tx
      .select()
      .from(paymentApprovals)
      .where(and(eq(paymentApprovals.id, id), eq(paymentApprovals.organizationId, organizationId)))
      .for('update');
    if (!row) throw notFound('Payment');
    if (row.status !== 'pending') throw conflict(text`This payment is already ${row.status}`);
    return row;
  };
  const releaseHold = (tx: Db, id: string) =>
    tx.delete(fundLocks).where(and(eq(fundLocks.referenceId, id), eq(fundLocks.reason, APPROVAL_HOLD)));

  app.get(
    '/organizations/:id/payment-approvals',
    {
      schema: {
        tags,
        description: 'Company payments above the approval limit that wait for (or had) a second signature.',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }),
        response: { 200: z.array(paymentApprovalSchema) },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const role = await orgRoleOf(app.db, req.params.id, me.id);
      if (!(role && ORG_FINANCE_ROLES.includes(role)) && !can(me.role, 'wallet.view_all'))
        throw forbidden('Only people who handle company money can see its payments');
      return paymentApprovalDtos(
        app.db,
        and(
          eq(paymentApprovals.organizationId, req.params.id),
          req.query.status ? eq(paymentApprovals.status, req.query.status) : undefined,
        ),
      );
    },
  );

  app.post(
    '/organizations/:id/payment-approvals/:aid/approve',
    {
      schema: {
        tags,
        description: 'Sign as the second finance member: the payment happens now.',
        params,
        response: { 200: paymentApprovalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const outcome = await app.db.transaction(async (tx) => {
        const approval = await lock(tx, req.params.id, req.params.aid);
        if (approval.requestedBy === me.id)
          throw forbidden('Someone else with access to company money must approve this');
        const wallet = await lockWallet(tx, approval.walletId);
        await assertWalletAccess(tx, wallet, me, true);
        await releaseHold(tx, approval.id);
        const actorId = approval.requestedBy;
        const touched: WalletRow[] = [wallet];
        let invoice: InvoiceRow | undefined;
        switch (approval.kind) {
          case 'transfer': {
            const action = approval.action as unknown as ApprovalActions['transfer'];
            const { target } = await executeTransfer(tx, {
              source: wallet,
              to: action.to,
              amount: approval.amount,
              note: action.note,
              actorId,
            });
            touched.push(target);
            break;
          }
          case 'invoice': {
            const action = approval.action as unknown as ApprovalActions['invoice'];
            const paid = await executeInvoicePayment(tx, {
              invoiceId: action.invoiceId,
              wallet,
              amount: approval.amount,
              actorId,
            });
            touched.push(paid.target);
            invoice = paid.invoice;
            break;
          }
          case 'exchange': {
            const action = approval.action as unknown as ApprovalActions['exchange'];
            const done = await executeExchange(tx, {
              wallet,
              toCurrency: action.toCurrency,
              amount: approval.amount,
              actorId,
            });
            touched.push(done.target);
            break;
          }
          case 'payroll': {
            const action = approval.action as unknown as ApprovalActions['payroll'];
            touched.push(...(await approvePayrollRun(tx, action.payrollRunId, actorId)));
            break;
          }
          case 'dividend': {
            const action = approval.action as unknown as ApprovalActions['dividend'];
            touched.push(...(await approveDividend(tx, action.dividendId, actorId)));
            break;
          }
        }
        const [updated] = await tx
          .update(paymentApprovals)
          .set({ status: 'approved', decidedBy: me.id, decidedAt: new Date() })
          .where(eq(paymentApprovals.id, approval.id))
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: 'payment.approve',
          targetType: 'organization',
          targetId: approval.organizationId,
          data: {
            kind: approval.kind,
            amount: formatAmount(approval.amount, approval.currency),
            currency: approval.currency,
            requestedBy: approval.requestedBy,
          },
          ip: req.ip,
        });
        return { approval: updated!, touched, invoice };
      });
      await announceApproval(app, outcome.approval);
      for (const w of outcome.touched.slice(1))
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      if (outcome.invoice) await announceInvoice(app, outcome.invoice, 'paid');
      return approvalDto(app, outcome.approval);
    },
  );

  app.post(
    '/organizations/:id/payment-approvals/:aid/reject',
    {
      schema: {
        tags,
        description: 'Decline a waiting payment (or withdraw your own); the money is released.',
        params,
        body: z.object({ reason: z.string().trim().min(3).max(500) }),
        response: { 200: paymentApprovalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const row = await app.db.transaction(async (tx) => {
        const approval = await lock(tx, req.params.id, req.params.aid);
        const wallet = await lockWallet(tx, approval.walletId);
        await assertWalletAccess(tx, wallet, me);
        const role = await orgRoleOf(tx, approval.organizationId, me.id);
        if (!role || !ORG_FINANCE_ROLES.includes(role))
          throw forbidden('Only people who handle company money can decline its payments');
        await releaseHold(tx, approval.id);
        if (approval.kind === 'payroll')
          await releasePayrollRun(
            tx,
            (approval.action as unknown as ApprovalActions['payroll']).payrollRunId,
          );
        if (approval.kind === 'dividend')
          await releaseDividend(tx, (approval.action as unknown as ApprovalActions['dividend']).dividendId);
        const [updated] = await tx
          .update(paymentApprovals)
          .set({ status: 'rejected', decidedBy: me.id, decidedAt: new Date(), reason: req.body.reason })
          .where(eq(paymentApprovals.id, approval.id))
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: 'payment.reject',
          targetType: 'organization',
          targetId: approval.organizationId,
          data: { kind: approval.kind, reason: req.body.reason },
          ip: req.ip,
        });
        return updated!;
      });
      await announceApproval(app, row);
      return approvalDto(app, row);
    },
  );
}
