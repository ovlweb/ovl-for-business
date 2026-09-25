import {
  currencyCodeSchema,
  formatAmount,
  fundLockSchema,
  ledgerEntrySchema,
  ORG_FINANCE_ROLES,
  pageOf,
  paginationQuery,
  parseAmount,
  paymentApprovalSchema,
  transferSchema,
  type TransferInput,
  walletSchema,
} from '@ovl/shared';
import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client';
import {
  fundLocks,
  ledgerEntries,
  organizationMembers,
  organizations,
  users,
  wallets,
} from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { iso } from '../../lib/mappers';
import { currentUser } from '../../plugins/auth';
import { announceApproval, approvalDto, needsSecondSignature, requestSecondSignature } from '../org-payments';
import {
  assertWalletAccess,
  getOrCreateWallet,
  listOwnerWallets,
  transfer,
  walletDtos,
  type WalletRow,
} from './service';

/** Users who should get a live `wallet.updated` event for this wallet. */
export async function walletAudience(db: Db, wallet: WalletRow): Promise<string[]> {
  if (wallet.ownerType === 'user') return [wallet.userId!];
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, wallet.organizationId!),
        inArray(organizationMembers.role, [...ORG_FINANCE_ROLES]),
      ),
    );
  return rows.map((r) => r.userId);
}

/** The wallet a transfer lands in (opened if needed), and how the recipient is called. */
export async function resolveRecipient(tx: Db, to: TransferInput['to'], source: WalletRow) {
  let target: WalletRow;
  let name: string;
  if (to.type === 'user') {
    const [user] = await tx.select().from(users).where(eq(users.username, to.username));
    if (!user || user.status !== 'active') throw notFound('Recipient');
    target = await getOrCreateWallet(tx, { type: 'user', id: user.id }, source.currency);
    name = `@${user.username}`;
  } else {
    const [org] = await tx.select().from(organizations).where(eq(organizations.slug, to.slug));
    if (!org || org.status !== 'active') throw notFound('Recipient company');
    target = await getOrCreateWallet(tx, { type: 'organization', id: org.id }, source.currency);
    name = org.name;
  }
  if (target.id === source.id) throw badRequest('Cannot transfer to the same wallet');
  return { target, name };
}

/** Move the money of a transfer; call inside a transaction. */
export async function executeTransfer(
  tx: Db,
  input: { source: WalletRow; to: TransferInput['to']; amount: bigint; note?: string; actorId: string },
) {
  const { source } = input;
  const { target, name: recipientName } = await resolveRecipient(tx, input.to, source);
  let senderName: string;
  if (source.ownerType === 'organization') {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, source.organizationId!));
    senderName = org?.name ?? '';
  } else {
    const [user] = await tx.select().from(users).where(eq(users.id, source.userId!));
    senderName = `@${user?.username ?? ''}`;
  }
  const note = input.note ? ` — ${input.note}` : '';
  await transfer(
    tx,
    source.id,
    target.id,
    input.amount,
    { out: 'transfer_out', in: 'transfer_in' },
    { description: `Transfer to ${recipientName}${note}`, actorId: input.actorId, referenceType: 'transfer' },
    `Transfer from ${senderName}${note}`,
  );
  return { target };
}

export async function walletRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['wallets'];
  app.addHook('preHandler', app.authenticate);

  const loadWallet = async (id: string) => {
    const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, id));
    if (!wallet) throw notFound('Wallet');
    return wallet;
  };

  app.get('/wallets', { schema: { tags, response: { 200: z.array(walletSchema) } } }, async (req) =>
    listOwnerWallets(app.db, { type: 'user', id: currentUser(req).id }),
  );

  app.post(
    '/wallets',
    {
      schema: {
        tags,
        description:
          'Open an (empty) personal wallet in a currency. Money arrives through the cash desk or transfers.',
        body: z.object({ currency: currencyCodeSchema }),
        response: { 201: walletSchema },
      },
    },
    async (req, reply) => {
      const wallet = await getOrCreateWallet(
        app.db,
        { type: 'user', id: currentUser(req).id },
        req.body.currency,
      );
      const [dto] = await walletDtos(app.db, [wallet]);
      return reply.status(201).send(dto!);
    },
  );

  app.get(
    '/wallets/:id',
    { schema: { tags, params: z.object({ id: z.uuid() }), response: { 200: walletSchema } } },
    async (req) => {
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      const [dto] = await walletDtos(app.db, [wallet]);
      return dto!;
    },
  );

  app.get(
    '/wallets/:id/entries',
    {
      schema: {
        tags,
        description: 'Account statement (immutable ledger), newest first.',
        params: z.object({ id: z.uuid() }),
        querystring: paginationQuery,
        response: { 200: pageOf(ledgerEntrySchema) },
      },
    },
    async (req) => {
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      const { limit, offset } = req.query;
      const [rows, [total]] = await Promise.all([
        app.db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.walletId, wallet.id))
          .orderBy(desc(ledgerEntries.id))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id)),
      ]);
      return {
        items: rows.map((e) => ({
          id: e.id,
          walletId: e.walletId,
          amount: formatAmount(e.amount, wallet.currency),
          balanceAfter: formatAmount(e.balanceAfter, wallet.currency),
          currency: wallet.currency,
          kind: e.kind,
          description: e.description,
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          createdAt: iso(e.createdAt),
        })),
        total: total?.n ?? 0,
        limit,
        offset,
      };
    },
  );

  app.get(
    '/wallets/:id/locks',
    {
      schema: {
        tags,
        description: 'Active fund locks (frozen parts of stock investments) with their unlock dates.',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.array(fundLockSchema) },
      },
    },
    async (req) => {
      const wallet = await loadWallet(req.params.id);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      const rows = await app.db
        .select()
        .from(fundLocks)
        .where(and(eq(fundLocks.walletId, wallet.id), gt(fundLocks.unlocksAt, new Date())))
        .orderBy(fundLocks.unlocksAt);
      return rows.map((l) => ({
        id: l.id,
        amount: formatAmount(l.amount, wallet.currency),
        currency: wallet.currency,
        reason: l.reason,
        unlocksAt: iso(l.unlocksAt),
        createdAt: iso(l.createdAt),
      }));
    },
  );

  app.post(
    '/wallets/transfer',
    {
      schema: {
        tags,
        description:
          'Send money to a person or a company in the same currency. Company payments of at least the ' +
          'approval limit wait for a second finance member (202).',
        body: transferSchema,
        response: { 200: walletSchema, 202: paymentApprovalSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const source = await loadWallet(req.body.fromWalletId);
      await assertWalletAccess(app.db, source, me, true);
      const amount = parseAmount(req.body.amount, source.currency);
      const { to, note } = req.body;

      const result = await app.db.transaction(async (tx) => {
        if (await needsSecondSignature(tx, source, amount)) {
          const recipient = await resolveRecipient(tx, to, source);
          const approval = await requestSecondSignature(tx, {
            wallet: source,
            kind: 'transfer',
            action: { to, ...(note ? { note } : {}) },
            amount,
            description: `Transfer ${formatAmount(amount, source.currency)} ${source.currency} to ${recipient.name}${note ? ` — ${note}` : ''}`,
            requestedBy: me.id,
            ip: req.ip,
          });
          return { approval };
        }
        return { done: await executeTransfer(tx, { source, to, amount, note, actorId: me.id }) };
      });
      if (result.approval) {
        await announceApproval(app, result.approval);
        return reply.status(202).send(await approvalDto(app, result.approval));
      }

      const [updated] = await app.db.select().from(wallets).where(eq(wallets.id, source.id));
      for (const w of [updated!, result.done!.target]) {
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      }
      const [dto] = await walletDtos(app.db, [updated!]);
      return dto!;
    },
  );
}
