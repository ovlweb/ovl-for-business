import { cashApprovalSchema, formatAmount, parseAmount, type CashApproval } from '@ovl/shared';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { cashApprovals, fundLocks, organizations, users, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { conflict, forbidden, insufficientFunds, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { completeCashRequest, lockPending, recordCashOperation } from './cash';
import { walletAudience } from './wallets/routes';
import { frozenAmounts, lockWallet } from './wallets/service';

/** Pending withdrawals keep their money aside until the second manager decides. */
const APPROVAL_HOLD = 'withdrawal_approval';
const HOLD_UNTIL = new Date('2100-01-01T00:00:00Z');

type ApprovalRow = typeof cashApprovals.$inferSelect;

/** Whether an amount (minor units) is large enough to need a second manager. */
export function needsFourEyes(config: Config, amount: bigint, currency: string): boolean {
  if (!config.CASH_FOUR_EYES_AMOUNT) return false;
  return amount >= parseAmount(String(config.CASH_FOUR_EYES_AMOUNT), currency);
}

export interface NewApproval {
  kind: 'operation' | 'request';
  cashRequestId?: string;
  walletId: string;
  type: 'deposit' | 'withdrawal';
  method: 'manager_transfer' | 'physical_cash';
  amount: bigint;
  currency: string;
  reference: string;
  note?: string;
  requestedBy: string;
  ip?: string;
}

export async function createApproval(tx: Db, input: NewApproval): Promise<ApprovalRow> {
  if (input.cashRequestId) {
    const [open] = await tx
      .select({ id: cashApprovals.id })
      .from(cashApprovals)
      .where(and(eq(cashApprovals.cashRequestId, input.cashRequestId), eq(cashApprovals.status, 'pending')));
    if (open) throw conflict('This request is already waiting for a second manager');
  }
  if (input.kind === 'operation' && input.type === 'withdrawal') {
    // A payout from the desk: check and hold the money now, like a payout request does.
    const wallet = await lockWallet(tx, input.walletId);
    const frozen = (await frozenAmounts(tx, [wallet.id])).get(wallet.id) ?? 0n;
    if (wallet.balance - frozen < input.amount)
      throw insufficientFunds(
        `Only ${formatAmount(wallet.balance - frozen, wallet.currency)} ${wallet.currency} is available`,
      );
  }
  const [row] = await tx
    .insert(cashApprovals)
    .values({
      kind: input.kind,
      cashRequestId: input.cashRequestId ?? null,
      walletId: input.walletId,
      type: input.type,
      method: input.method,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      note: input.note ?? '',
      requestedBy: input.requestedBy,
    })
    .returning();
  if (input.kind === 'operation' && input.type === 'withdrawal') {
    await tx.insert(fundLocks).values({
      walletId: input.walletId,
      amount: input.amount,
      reason: APPROVAL_HOLD,
      referenceId: row!.id,
      unlocksAt: HOLD_UNTIL,
    });
  }
  await audit(tx, {
    actorId: input.requestedBy,
    action: 'cash.four_eyes_requested',
    targetType: 'wallet',
    targetId: input.walletId,
    data: {
      kind: input.kind,
      type: input.type,
      amount: formatAmount(input.amount, input.currency),
      currency: input.currency,
      reference: input.reference,
    },
    ip: input.ip,
  });
  return row!;
}

/** When a request is declined, its waiting approval goes too. */
export async function dropPendingApprovals(tx: Db, cashRequestId: string, actorId: string, reason: string) {
  await tx
    .update(cashApprovals)
    .set({ status: 'rejected', decidedBy: actorId, decidedAt: new Date(), rejectReason: reason })
    .where(and(eq(cashApprovals.cashRequestId, cashRequestId), eq(cashApprovals.status, 'pending')));
}

const requester = alias(users, 'approval_requester');
const decider = alias(users, 'approval_decider');
const ownerUser = alias(users, 'approval_owner');

export async function approvalDtos(db: Db, where?: SQL, limit = 100): Promise<CashApproval[]> {
  const rows = await db
    .select({
      a: cashApprovals,
      wallet: wallets,
      requester: { id: requester.id, username: requester.username, displayName: requester.displayName },
      decider: { id: decider.id, username: decider.username, displayName: decider.displayName },
      ownerUserName: ownerUser.displayName,
      orgName: organizations.name,
    })
    .from(cashApprovals)
    .innerJoin(wallets, eq(wallets.id, cashApprovals.walletId))
    .innerJoin(requester, eq(requester.id, cashApprovals.requestedBy))
    .leftJoin(decider, eq(decider.id, cashApprovals.decidedBy))
    .leftJoin(ownerUser, eq(ownerUser.id, wallets.userId))
    .leftJoin(organizations, eq(organizations.id, wallets.organizationId))
    .where(where)
    .orderBy(desc(cashApprovals.createdAt))
    .limit(limit);
  return rows.map(({ a, wallet, requester, decider, ownerUserName, orgName }) => ({
    id: a.id,
    kind: a.kind,
    cashRequestId: a.cashRequestId,
    walletId: a.walletId,
    ownerType: wallet.ownerType,
    ownerName: ownerUserName ?? orgName ?? '',
    type: a.type,
    method: a.method,
    amount: formatAmount(a.amount, a.currency),
    currency: a.currency,
    reference: a.reference,
    note: a.note,
    status: a.status,
    requestedBy: requester,
    decidedBy: decider?.id ? decider : null,
    rejectReason: a.rejectReason,
    createdAt: iso(a.createdAt),
    decidedAt: isoOrNull(a.decidedAt),
  }));
}

export async function pendingApprovalCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cashApprovals)
    .where(eq(cashApprovals.status, 'pending'));
  return row?.n ?? 0;
}

export async function cashApprovalRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['admin'];

  const lock = async (tx: Db, id: string) => {
    const [row] = await tx.select().from(cashApprovals).where(eq(cashApprovals.id, id)).for('update');
    if (!row) throw notFound('Approval');
    if (row.status !== 'pending') throw conflict(`This operation is already ${row.status}`);
    return row;
  };
  const announce = async (walletId: string) => {
    const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, walletId));
    if (wallet)
      app.hub.sendToUsers(await walletAudience(app.db, wallet), { type: 'wallet.updated', walletId });
  };

  app.get(
    '/admin/cash-approvals',
    {
      preHandler: app.requirePermission('wallet.view_all'),
      schema: {
        tags,
        description: `Cash operations of at least CASH_FOUR_EYES_AMOUNT waiting for a second finance manager.`,
        querystring: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }),
        response: { 200: z.array(cashApprovalSchema) },
      },
    },
    async (req) =>
      approvalDtos(app.db, req.query.status ? eq(cashApprovals.status, req.query.status) : undefined),
  );

  app.post(
    '/admin/cash-approvals/:id/approve',
    {
      preHandler: app.requirePermission('wallet.cash'),
      schema: {
        tags,
        description: 'Confirm as the second manager: the operation happens now.',
        params: z.object({ id: z.uuid() }),
        response: { 200: cashApprovalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const walletId = await app.db.transaction(async (tx) => {
        const approval = await lock(tx, req.params.id);
        if (approval.requestedBy === me.id) throw forbidden('A different finance manager must confirm this');
        const wallet = await lockWallet(tx, approval.walletId);
        if (wallet.userId === me.id) throw forbidden('You cannot confirm an operation on your own balance');
        let opId: string;
        if (approval.kind === 'request') {
          const request = await lockPending(tx, approval.cashRequestId!);
          if (request.requestedBy === me.id)
            throw forbidden('You asked for this; another manager must confirm');
          opId = await completeCashRequest(tx, request, {
            managerId: approval.requestedBy,
            reference: approval.reference,
            note: approval.note,
            ip: req.ip,
          });
        } else {
          await tx
            .delete(fundLocks)
            .where(and(eq(fundLocks.referenceId, approval.id), eq(fundLocks.reason, APPROVAL_HOLD)));
          opId = await recordCashOperation(tx, {
            wallet,
            type: approval.type,
            method: approval.method,
            amount: approval.amount,
            reference: approval.reference,
            note: approval.note,
            actorId: approval.requestedBy,
            ip: req.ip,
          });
        }
        await tx
          .update(cashApprovals)
          .set({ status: 'approved', decidedBy: me.id, decidedAt: new Date(), cashOperationId: opId })
          .where(eq(cashApprovals.id, approval.id));
        await audit(tx, {
          actorId: me.id,
          action: 'cash.four_eyes_approve',
          targetType: 'wallet',
          targetId: approval.walletId,
          data: { amount: formatAmount(approval.amount, approval.currency), currency: approval.currency },
          ip: req.ip,
        });
        return approval.walletId;
      });
      await announce(walletId);
      const [dto] = await approvalDtos(app.db, eq(cashApprovals.id, req.params.id), 1);
      return dto!;
    },
  );

  app.post(
    '/admin/cash-approvals/:id/reject',
    {
      preHandler: app.requirePermission('wallet.cash'),
      schema: {
        tags,
        params: z.object({ id: z.uuid() }),
        body: z.object({ reason: z.string().trim().min(3).max(500) }),
        response: { 200: cashApprovalSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const walletId = await app.db.transaction(async (tx) => {
        const approval = await lock(tx, req.params.id);
        await tx
          .delete(fundLocks)
          .where(and(eq(fundLocks.referenceId, approval.id), eq(fundLocks.reason, APPROVAL_HOLD)));
        await tx
          .update(cashApprovals)
          .set({ status: 'rejected', decidedBy: me.id, decidedAt: new Date(), rejectReason: req.body.reason })
          .where(eq(cashApprovals.id, approval.id));
        await audit(tx, {
          actorId: me.id,
          action: 'cash.four_eyes_reject',
          targetType: 'wallet',
          targetId: approval.walletId,
          data: { reason: req.body.reason },
          ip: req.ip,
        });
        return approval.walletId;
      });
      await announce(walletId);
      const [dto] = await approvalDtos(app.db, eq(cashApprovals.id, req.params.id), 1);
      return dto!;
    },
  );
}
