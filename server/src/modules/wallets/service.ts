import { can, formatAmount, ORG_FINANCE_ROLES, type Role, type Wallet } from '@ovl/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { fundLocks, ledgerEntries, organizationMembers, wallets } from '../../db/schema';
import { badRequest, forbidden, insufficientFunds, notFound } from '../../lib/errors';
import { iso } from '../../lib/mappers';

export type WalletRow = typeof wallets.$inferSelect;
export type WalletOwner = { type: 'user'; id: string } | { type: 'organization'; id: string };
type LedgerKind = (typeof ledgerEntries.$inferInsert)['kind'];

export interface EntryOptions {
  description?: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string | null;
  counterpartyWalletId?: string;
}

export function walletOwnerId(w: WalletRow): string {
  return (w.ownerType === 'user' ? w.userId : w.organizationId)!;
}

export function toWalletDto(w: WalletRow, frozen: bigint): Wallet {
  return {
    id: w.id,
    ownerType: w.ownerType,
    ownerId: walletOwnerId(w),
    currency: w.currency,
    balance: formatAmount(w.balance, w.currency),
    frozen: formatAmount(frozen, w.currency),
    available: formatAmount(w.balance - frozen, w.currency),
    createdAt: iso(w.createdAt),
  };
}

export async function getOrCreateWallet(db: Db, owner: WalletOwner, currency: string): Promise<WalletRow> {
  const ownerColumn = owner.type === 'user' ? wallets.userId : wallets.organizationId;
  await db
    .insert(wallets)
    .values({
      ownerType: owner.type,
      userId: owner.type === 'user' ? owner.id : null,
      organizationId: owner.type === 'organization' ? owner.id : null,
      currency,
    })
    .onConflictDoNothing({ target: [ownerColumn, wallets.currency] });
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(ownerColumn, owner.id), eq(wallets.currency, currency)));
  return wallet!;
}

/** Sum of still-active fund locks per wallet. */
export async function frozenAmounts(
  db: Db,
  walletIds: string[],
  now = new Date(),
): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  if (!walletIds.length) return result;
  const rows = await db
    .select({ walletId: fundLocks.walletId, total: sql<string>`coalesce(sum(${fundLocks.amount}), 0)` })
    .from(fundLocks)
    .where(and(inArray(fundLocks.walletId, walletIds), gt(fundLocks.unlocksAt, now)))
    .groupBy(fundLocks.walletId);
  for (const row of rows) result.set(row.walletId, BigInt(row.total));
  return result;
}

export async function walletDtos(db: Db, rows: WalletRow[]): Promise<Wallet[]> {
  const frozen = await frozenAmounts(
    db,
    rows.map((w) => w.id),
  );
  return rows.map((w) => toWalletDto(w, frozen.get(w.id) ?? 0n));
}

export async function listOwnerWallets(db: Db, owner: WalletOwner): Promise<Wallet[]> {
  const ownerColumn = owner.type === 'user' ? wallets.userId : wallets.organizationId;
  const rows = await db.select().from(wallets).where(eq(ownerColumn, owner.id)).orderBy(wallets.currency);
  return walletDtos(db, rows);
}

/** Lock the wallet row for the rest of the transaction. */
export async function lockWallet(db: Db, walletId: string): Promise<WalletRow> {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).for('update');
  if (!wallet) throw notFound('Wallet');
  return wallet;
}

async function postEntry(db: Db, wallet: WalletRow, delta: bigint, kind: LedgerKind, options: EntryOptions) {
  const [updated] = await db
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${delta.toString()}::bigint` })
    .where(eq(wallets.id, wallet.id))
    .returning();
  await db.insert(ledgerEntries).values({
    walletId: wallet.id,
    amount: delta,
    balanceAfter: updated!.balance,
    kind,
    description: options.description ?? '',
    referenceType: options.referenceType ?? null,
    referenceId: options.referenceId ?? null,
    actorId: options.actorId ?? null,
    counterpartyWalletId: options.counterpartyWalletId ?? null,
  });
  return updated!;
}

export async function credit(
  db: Db,
  walletId: string,
  amount: bigint,
  kind: LedgerKind,
  options: EntryOptions = {},
) {
  if (amount <= 0n) throw badRequest('Amount must be positive');
  const wallet = await lockWallet(db, walletId);
  return postEntry(db, wallet, amount, kind, options);
}

/** Debit only what is available (balance minus active fund locks). */
export async function debit(
  db: Db,
  walletId: string,
  amount: bigint,
  kind: LedgerKind,
  options: EntryOptions = {},
) {
  if (amount <= 0n) throw badRequest('Amount must be positive');
  const wallet = await lockWallet(db, walletId);
  const frozen = (await frozenAmounts(db, [walletId])).get(walletId) ?? 0n;
  if (wallet.balance - frozen < amount) {
    throw insufficientFunds(
      `Insufficient available funds: ${formatAmount(wallet.balance - frozen, wallet.currency)} ${wallet.currency} available`,
    );
  }
  return postEntry(db, wallet, -amount, kind, options);
}

export async function transfer(
  db: Db,
  fromId: string,
  toId: string,
  amount: bigint,
  kinds: { out: LedgerKind; in: LedgerKind },
  options: EntryOptions = {},
  incomingDescription?: string,
) {
  if (fromId === toId) throw badRequest('Cannot transfer to the same wallet');
  // Lock both rows in a stable order to avoid deadlocks between concurrent transfers.
  const [first, second] = [fromId, toId].sort();
  const a = await lockWallet(db, first!);
  const b = await lockWallet(db, second!);
  if (a.currency !== b.currency) throw badRequest('Wallets use different currencies');
  const from = await debit(db, fromId, amount, kinds.out, { ...options, counterpartyWalletId: toId });
  const to = await credit(db, toId, amount, kinds.in, {
    ...options,
    description: incomingDescription ?? options.description,
    counterpartyWalletId: fromId,
  });
  return { from, to };
}

/** Organization roles of a user, used for finance access checks. */
export async function orgRoleOf(db: Db, organizationId: string, userId: string) {
  const [member] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)),
    );
  return member?.role ?? null;
}

/**
 * Can `user` see (and, if `move`, spend from) this wallet?
 * Staff with wallet.view_all may look but never spend other people's money.
 */
export async function assertWalletAccess(
  db: Db,
  wallet: WalletRow,
  user: { id: string; role: Role },
  move = false,
): Promise<void> {
  if (wallet.ownerType === 'user' && wallet.userId === user.id) return;
  if (wallet.ownerType === 'organization') {
    const role = await orgRoleOf(db, wallet.organizationId!, user.id);
    if (role && ORG_FINANCE_ROLES.includes(role)) return;
  }
  if (!move && can(user.role, 'wallet.view_all')) return;
  throw forbidden('You do not have access to this wallet');
}
