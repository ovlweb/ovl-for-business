import {
  cashRequestInputSchema,
  cashRequestSchema,
  CASH_REQUEST_STATUSES,
  completeCashRequestSchema,
  declineCashRequestSchema,
  formatAmount,
  parseAmount,
  type CashRequest,
} from '@ovl/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { cashOperations, cashRequests, fundLocks, organizations, users, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, insufficientFunds, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { createApproval, dropPendingApprovals, needsFourEyes } from './cash-approvals';
import { walletAudience } from './wallets/routes';
import {
  assertWalletAccess,
  credit,
  debit,
  frozenAmounts,
  lockWallet,
  type WalletRow,
} from './wallets/service';
import { queueNotification } from '../lib/notify';
import { text } from '../lib/i18n';

/** Pending payouts hold the money until a manager pays it out or declines. */
const WITHDRAWAL_HOLD = 'withdrawal_request';
const HOLD_UNTIL = new Date('2100-01-01T00:00:00Z');

export interface CashOperationArgs {
  wallet: WalletRow;
  type: 'deposit' | 'withdrawal';
  method: 'manager_transfer' | 'physical_cash';
  amount: bigint;
  reference: string;
  note?: string;
  actorId: string;
  ip?: string;
}

/** Record a cash-desk operation and move the money; call inside a transaction. */
export async function recordCashOperation(tx: Db, args: CashOperationArgs): Promise<string> {
  const [op] = await tx
    .insert(cashOperations)
    .values({
      walletId: args.wallet.id,
      type: args.type,
      method: args.method,
      amount: args.amount,
      currency: args.wallet.currency,
      reference: args.reference,
      note: args.note ?? '',
      processedBy: args.actorId,
    })
    .returning({ id: cashOperations.id });
  const method = args.method === 'physical_cash' ? 'cash desk' : 'manager transfer';
  const options = {
    description: `${args.type === 'deposit' ? 'Deposit' : 'Withdrawal'} via ${method} (ref. ${args.reference})`,
    referenceType: 'cash_operation',
    referenceId: op!.id,
    actorId: args.actorId,
  };
  if (args.type === 'deposit') await credit(tx, args.wallet.id, args.amount, 'deposit', options);
  else await debit(tx, args.wallet.id, args.amount, 'withdrawal', options);
  await audit(tx, {
    actorId: args.actorId,
    action: `wallet.${args.type}`,
    targetType: 'wallet',
    targetId: args.wallet.id,
    data: {
      amount: formatAmount(args.amount, args.wallet.currency),
      currency: args.wallet.currency,
      method: args.method,
      reference: args.reference,
    },
    ip: args.ip,
  });
  return op!.id;
}

const requester = alias(users, 'requester');
const handler = alias(users, 'handler');
const ownerUser = alias(users, 'owner_user');

export async function cashRequestDtos(db: Db, where?: SQL, limit = 100): Promise<CashRequest[]> {
  const rows = await db
    .select({
      r: cashRequests,
      wallet: wallets,
      requester: { id: requester.id, username: requester.username, displayName: requester.displayName },
      handler: { id: handler.id, username: handler.username, displayName: handler.displayName },
      ownerUserName: ownerUser.displayName,
      orgName: organizations.name,
      reference: cashOperations.reference,
      awaitingApproval: sql<boolean>`exists (select 1 from cash_approvals a where a.cash_request_id = ${cashRequests.id} and a.status = 'pending')`,
    })
    .from(cashRequests)
    .innerJoin(wallets, eq(wallets.id, cashRequests.walletId))
    .innerJoin(requester, eq(requester.id, cashRequests.requestedBy))
    .leftJoin(handler, eq(handler.id, cashRequests.handledBy))
    .leftJoin(ownerUser, eq(ownerUser.id, wallets.userId))
    .leftJoin(organizations, eq(organizations.id, wallets.organizationId))
    .leftJoin(cashOperations, eq(cashOperations.id, cashRequests.cashOperationId))
    .where(where)
    .orderBy(desc(cashRequests.createdAt))
    .limit(limit);
  return rows.map(
    ({ r, wallet, requester, handler, ownerUserName, orgName, reference, awaitingApproval }) => ({
      id: r.id,
      walletId: r.walletId,
      ownerType: wallet.ownerType,
      ownerId: (wallet.userId ?? wallet.organizationId)!,
      ownerName: ownerUserName ?? orgName ?? '',
      type: r.type,
      method: r.method,
      amount: formatAmount(r.amount, r.currency),
      currency: r.currency,
      note: r.note,
      status: r.status,
      requestedBy: requester,
      handledBy: handler?.id ? handler : null,
      awaitingApproval,
      reference: reference ?? null,
      declineReason: r.declineReason,
      createdAt: iso(r.createdAt),
      handledAt: isoOrNull(r.handledAt),
    }),
  );
}

export async function releaseHold(tx: Db, requestId: string) {
  await tx
    .delete(fundLocks)
    .where(and(eq(fundLocks.referenceId, requestId), eq(fundLocks.reason, WITHDRAWAL_HOLD)));
}

/** Lock a pending request for the rest of the transaction. */
export async function lockPending(tx: Db, id: string) {
  const [request] = await tx.select().from(cashRequests).where(eq(cashRequests.id, id)).for('update');
  if (!request) throw notFound('Request');
  if (request.status !== 'pending') throw conflict(text`This request is already ${request.status}`);
  return request;
}

type CashRequestRow = typeof cashRequests.$inferSelect;

/** Pay out / confirm a cash request: record the cash operation, move the money, mark it done. */
export async function completeCashRequest(
  tx: Db,
  request: CashRequestRow,
  opts: { managerId: string; reference: string; note?: string; ip?: string },
): Promise<string> {
  const wallet = await lockWallet(tx, request.walletId);
  if (request.type === 'withdrawal') await releaseHold(tx, request.id);
  const opId = await recordCashOperation(tx, {
    wallet,
    type: request.type,
    method: request.method,
    amount: request.amount,
    reference: opts.reference,
    note: opts.note,
    actorId: opts.managerId,
    ip: opts.ip,
  });
  await tx
    .update(cashRequests)
    .set({ status: 'completed', handledBy: opts.managerId, handledAt: new Date(), cashOperationId: opId })
    .where(eq(cashRequests.id, request.id));
  return opId;
}

export async function cashRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['wallets'];
  const adminTags = ['admin'];

  const loadWallet = async (id: string) => {
    const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, id));
    if (!wallet) throw notFound('Wallet');
    return wallet;
  };

  const announce = async (walletId: string, requestId: string, status: string) => {
    const wallet = await loadWallet(walletId);
    const audience = await walletAudience(app.db, wallet);
    if (status === 'completed' || status === 'declined') {
      const [request] = await app.db.select().from(cashRequests).where(eq(cashRequests.id, requestId));
      if (request) {
        const amount = `${formatAmount(request.amount, request.currency)} ${request.currency}`;
        const deposit = request.type === 'deposit';
        await queueNotification(app.db, [request.requestedBy], {
          type: 'cash_request',
          title:
            status === 'completed'
              ? deposit
                ? text`Deposit of ${amount} completed`
                : text`Payout of ${amount} completed`
              : deposit
                ? text`Deposit of ${amount} declined`
                : text`Payout of ${amount} declined`,
          body: status === 'declined' ? (request.declineReason ?? '') : 'Your balance is up to date.',
          link: '/wallet',
        });
      }
    }
    app.hub.sendToUsers(audience, { type: 'cash_request.updated', requestId, walletId, status });
    app.hub.sendToUsers(audience, { type: 'wallet.updated', walletId });
  };

  // ----- People ----------------------------------------------------------------------------

  app.post(
    '/wallets/:id/cash-requests',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Ask a finance manager for a deposit or a payout. A payout holds the amount until it is paid out or declined.',
        params: z.object({ id: z.uuid() }),
        body: cashRequestInputSchema,
        response: { 201: cashRequestSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, me, true);
      const amount = parseAmount(req.body.amount, wallet.currency);
      if (amount <= 0n) throw badRequest('Amount must be positive');
      const id = await app.db.transaction(async (tx) => {
        const locked = await lockWallet(tx, wallet.id);
        if (req.body.type === 'withdrawal') {
          const frozen = (await frozenAmounts(tx, [wallet.id])).get(wallet.id) ?? 0n;
          if (locked.balance - frozen < amount) {
            throw insufficientFunds(
              text`Only ${formatAmount(locked.balance - frozen, wallet.currency)} ${wallet.currency} is available to pay out`,
            );
          }
        }
        const [request] = await tx
          .insert(cashRequests)
          .values({
            walletId: wallet.id,
            type: req.body.type,
            method: req.body.method,
            amount,
            currency: wallet.currency,
            note: req.body.note ?? '',
            requestedBy: me.id,
          })
          .returning({ id: cashRequests.id });
        if (req.body.type === 'withdrawal') {
          await tx.insert(fundLocks).values({
            walletId: wallet.id,
            amount,
            reason: WITHDRAWAL_HOLD,
            referenceId: request!.id,
            unlocksAt: HOLD_UNTIL,
          });
        }
        return request!.id;
      });
      await announce(wallet.id, id, 'pending');
      const [dto] = await cashRequestDtos(app.db, eq(cashRequests.id, id), 1);
      return reply.status(201).send(dto!);
    },
  );

  app.get(
    '/wallets/:id/cash-requests',
    {
      preHandler: app.authenticate,
      schema: { tags, params: z.object({ id: z.uuid() }), response: { 200: z.array(cashRequestSchema) } },
    },
    async (req) => {
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      return cashRequestDtos(app.db, eq(cashRequests.walletId, wallet.id), 50);
    },
  );

  app.post(
    '/cash-requests/:id/cancel',
    {
      preHandler: app.authenticate,
      schema: { tags, params: z.object({ id: z.uuid() }), response: { 200: cashRequestSchema } },
    },
    async (req) => {
      const me = currentUser(req);
      const walletId = await app.db.transaction(async (tx) => {
        const request = await lockPending(tx, req.params.id);
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, request.walletId));
        await assertWalletAccess(tx, wallet!, me, true);
        await releaseHold(tx, request.id);
        await tx
          .update(cashRequests)
          .set({ status: 'cancelled', handledAt: new Date() })
          .where(eq(cashRequests.id, request.id));
        return request.walletId;
      });
      await announce(walletId, req.params.id, 'cancelled');
      const [dto] = await cashRequestDtos(app.db, eq(cashRequests.id, req.params.id), 1);
      return dto!;
    },
  );

  // ----- Finance managers ------------------------------------------------------------------

  app.get(
    '/admin/cash-requests',
    {
      preHandler: app.requirePermission('wallet.view_all'),
      schema: {
        tags: adminTags,
        querystring: z.object({ status: z.enum(CASH_REQUEST_STATUSES).optional() }),
        response: { 200: z.array(cashRequestSchema) },
      },
    },
    async (req) =>
      cashRequestDtos(app.db, req.query.status ? eq(cashRequests.status, req.query.status) : undefined),
  );

  app.post(
    '/admin/cash-requests/:id/complete',
    {
      preHandler: app.requirePermission('wallet.cash'),
      schema: {
        tags: adminTags,
        description: 'Fulfil a request: records the cash operation and moves the money.',
        params: z.object({ id: z.uuid() }),
        body: completeCashRequestSchema,
        response: { 200: cashRequestSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { walletId, done } = await app.db.transaction(async (tx) => {
        const request = await lockPending(tx, req.params.id);
        if (request.requestedBy === me.id)
          throw forbidden('Another finance manager must handle your own request');
        if (needsFourEyes(app.config, request.amount, request.currency)) {
          // Large amounts: a second manager confirms (see cash-approvals.ts).
          await createApproval(tx, {
            kind: 'request',
            cashRequestId: request.id,
            walletId: request.walletId,
            type: request.type,
            method: request.method,
            amount: request.amount,
            currency: request.currency,
            reference: req.body.reference,
            note: req.body.note,
            requestedBy: me.id,
            ip: req.ip,
          });
          return { walletId: request.walletId, done: false };
        }
        await completeCashRequest(tx, request, {
          managerId: me.id,
          reference: req.body.reference,
          note: req.body.note,
          ip: req.ip,
        });
        return { walletId: request.walletId, done: true };
      });
      if (done) await announce(walletId, req.params.id, 'completed');
      const [dto] = await cashRequestDtos(app.db, eq(cashRequests.id, req.params.id), 1);
      return dto!;
    },
  );

  app.post(
    '/admin/cash-requests/:id/decline',
    {
      preHandler: app.requirePermission('wallet.cash'),
      schema: {
        tags: adminTags,
        params: z.object({ id: z.uuid() }),
        body: declineCashRequestSchema,
        response: { 200: cashRequestSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const walletId = await app.db.transaction(async (tx) => {
        const request = await lockPending(tx, req.params.id);
        await releaseHold(tx, request.id);
        await dropPendingApprovals(tx, request.id, me.id, 'The request was declined');
        await tx
          .update(cashRequests)
          .set({
            status: 'declined',
            handledBy: me.id,
            handledAt: new Date(),
            declineReason: req.body.reason,
          })
          .where(eq(cashRequests.id, request.id));
        await audit(tx, {
          actorId: me.id,
          action: 'cash_request.decline',
          targetType: 'wallet',
          targetId: request.walletId,
          data: {
            amount: formatAmount(request.amount, request.currency),
            currency: request.currency,
            reason: req.body.reason,
          },
          ip: req.ip,
        });
        return request.walletId;
      });
      await announce(walletId, req.params.id, 'declined');
      const [dto] = await cashRequestDtos(app.db, eq(cashRequests.id, req.params.id), 1);
      return dto!;
    },
  );
}
