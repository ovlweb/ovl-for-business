import {
  CURRENCY_CODES,
  exchangeInfoSchema,
  exchangeInputSchema,
  exchangeQuoteSchema,
  exchangeResultSchema,
  formatAmount,
  parseAmount,
  paymentApprovalSchema,
  setExchangeSchema,
  type ExchangeQuote,
} from '@ovl/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { exchangeRates, exchanges, platformSettings, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { convert, crossRate, loadRateTable, type RateTable } from '../lib/fx';
import { iso } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { announceApproval, approvalDto, needsSecondSignature, requestSecondSignature } from './org-payments';
import { walletAudience } from './wallets/routes';
import {
  assertWalletAccess,
  credit,
  debit,
  getOrCreateWallet,
  lockWallet,
  walletOwnerId,
  type WalletRow,
} from './wallets/service';
import { text } from '../lib/i18n';

export function quote(table: RateTable, fromCurrency: string, toCurrency: string, amount: bigint) {
  if (fromCurrency === toCurrency) throw badRequest('Pick a different currency to exchange into');
  if (amount <= 0n) throw badRequest('Amount must be positive');
  const fee = (amount * table.feeBasisPoints) / 10_000n;
  const receive = convert(amount - fee, fromCurrency, toCurrency, table);
  const rate = crossRate(fromCurrency, toCurrency, table);
  if (receive === null || rate === null)
    throw badRequest(text`There is no exchange rate for ${fromCurrency} → ${toCurrency} yet`);
  if (receive <= 0n) throw badRequest('The amount is too small to exchange');
  return { fee, receive, rate };
}

const quoteDto = (from: string, to: string, amount: bigint, q: ReturnType<typeof quote>): ExchangeQuote => ({
  fromCurrency: from,
  toCurrency: to,
  amount: formatAmount(amount, from),
  fee: formatAmount(q.fee, from),
  receive: formatAmount(q.receive, to),
  rate: q.rate,
});

/** Exchange between two balances of the same owner; call inside a transaction. */
export async function executeExchange(
  tx: Db,
  input: { wallet: WalletRow; toCurrency: string; amount: bigint; actorId: string },
) {
  const table = await loadRateTable(tx);
  const q = quote(table, input.wallet.currency, input.toCurrency, input.amount);
  await lockWallet(tx, input.wallet.id);
  const owner = { type: input.wallet.ownerType, id: walletOwnerId(input.wallet) } as const;
  const target = await getOrCreateWallet(tx, owner, input.toCurrency);
  const [row] = await tx
    .insert(exchanges)
    .values({
      actorId: input.actorId,
      fromWalletId: input.wallet.id,
      toWalletId: target.id,
      fromAmount: input.amount,
      toAmount: q.receive,
      fee: q.fee,
      rate: q.rate,
    })
    .returning();
  const options = { actorId: input.actorId, referenceType: 'exchange', referenceId: row!.id };
  await debit(tx, input.wallet.id, input.amount, 'exchange_out', {
    ...options,
    description: `Exchange to ${input.toCurrency} at ${q.rate}${q.fee > 0n ? ` (fee ${formatAmount(q.fee, input.wallet.currency)})` : ''}`,
    counterpartyWalletId: target.id,
  });
  await credit(tx, target.id, q.receive, 'exchange_in', {
    ...options,
    description: `Exchange from ${input.wallet.currency} at ${q.rate}`,
    counterpartyWalletId: input.wallet.id,
  });
  return { row: row!, target, quote: q };
}

export async function exchangeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['wallets'];

  const infoOf = (table: RateTable) => ({
    base: table.base,
    feePercent: table.feePercent,
    rates: [...table.rates]
      .map(([currency, r]) => ({
        currency,
        rate: formatRate(r.rate),
        updatedAt: iso(r.updatedAt),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  });

  app.get(
    '/exchange',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Exchange rates, the base currency and the fee.',
        response: { 200: exchangeInfoSchema },
      },
    },
    async () => infoOf(await loadRateTable(app.db)),
  );

  const loadWallet = async (id: string) => {
    const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, id));
    if (!wallet) throw notFound('Wallet');
    return wallet;
  };

  app.post(
    '/exchange/quote',
    {
      preHandler: app.authenticate,
      schema: { tags, body: exchangeInputSchema, response: { 200: exchangeQuoteSchema } },
    },
    async (req) => {
      const wallet = await loadWallet(req.body.fromWalletId);
      await assertWalletAccess(app.db, wallet, currentUser(req));
      const amount = parseAmount(req.body.amount, wallet.currency);
      const table = await loadRateTable(app.db);
      return quoteDto(
        wallet.currency,
        req.body.toCurrency,
        amount,
        quote(table, wallet.currency, req.body.toCurrency, amount),
      );
    },
  );

  app.post(
    '/exchange',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          "Exchange money between two of the owner's balances at the managed rate. Company payments above " +
          'the approval limit wait for a second finance member (202).',
        body: exchangeInputSchema,
        response: { 200: exchangeResultSchema, 202: paymentApprovalSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const wallet = await loadWallet(req.body.fromWalletId);
      await assertWalletAccess(app.db, wallet, me, true);
      const amount = parseAmount(req.body.amount, wallet.currency);
      const outcome = await app.db.transaction(async (tx) => {
        const q = quote(await loadRateTable(tx), wallet.currency, req.body.toCurrency, amount);
        if (await needsSecondSignature(tx, wallet, amount)) {
          const approval = await requestSecondSignature(tx, {
            wallet,
            kind: 'exchange',
            action: { toCurrency: req.body.toCurrency },
            amount,
            description: `Exchange ${formatAmount(amount, wallet.currency)} ${wallet.currency} to ${req.body.toCurrency} (about ${formatAmount(q.receive, req.body.toCurrency)})`,
            requestedBy: me.id,
            ip: req.ip,
          });
          return { approval };
        }
        return {
          done: await executeExchange(tx, {
            wallet,
            toCurrency: req.body.toCurrency,
            amount,
            actorId: me.id,
          }),
        };
      });
      if (outcome.approval) {
        await announceApproval(app, outcome.approval);
        return reply.status(202).send(await approvalDto(app, outcome.approval));
      }
      const { row, target, quote: q } = outcome.done!;
      for (const w of [wallet, target])
        app.hub.sendToUsers(await walletAudience(app.db, w), { type: 'wallet.updated', walletId: w.id });
      return {
        ...quoteDto(wallet.currency, target.currency, amount, q),
        id: row.id,
        fromWalletId: wallet.id,
        toWalletId: target.id,
        createdAt: iso(row.createdAt),
      };
    },
  );

  app.put(
    '/admin/exchange',
    {
      preHandler: app.requirePermission('exchange.manage'),
      schema: {
        tags: ['admin'],
        description: 'Set the base currency, the fee and rates (a null rate removes a currency).',
        body: setExchangeSchema,
        response: { 200: exchangeInfoSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const body = req.body;
      await app.db.transaction(async (tx) => {
        const current = await loadRateTable(tx);
        if (body.base || body.feePercent) {
          const value = {
            base: body.base ?? current.base,
            feePercent: body.feePercent ?? current.feePercent,
          };
          await tx
            .insert(platformSettings)
            .values({ key: 'exchange', value, updatedBy: me.id })
            .onConflictDoUpdate({
              target: platformSettings.key,
              set: { value, updatedBy: me.id, updatedAt: new Date() },
            });
        }
        for (const r of body.rates ?? []) {
          if (!CURRENCY_CODES.includes(r.currency)) throw badRequest(text`Unknown currency ${r.currency}`);
          if (r.rate === null || Number(r.rate) === 0) {
            await tx.delete(exchangeRates).where(eq(exchangeRates.currency, r.currency));
          } else {
            await tx
              .insert(exchangeRates)
              .values({ currency: r.currency, rate: r.rate, updatedBy: me.id })
              .onConflictDoUpdate({
                target: exchangeRates.currency,
                set: { rate: r.rate, updatedBy: me.id, updatedAt: new Date() },
              });
          }
        }
        // A rate for the base currency itself is always 1.
        const table = await loadRateTable(tx);
        await tx.delete(exchangeRates).where(inArray(exchangeRates.currency, [table.base]));
        await audit(tx, {
          actorId: me.id,
          action: 'exchange.update',
          targetType: 'settings',
          targetId: 'exchange',
          data: { base: table.base, feePercent: table.feePercent, rates: (body.rates ?? []).length },
          ip: req.ip,
        });
      });
      return infoOf(await loadRateTable(app.db));
    },
  );
}

function formatRate(scaled: bigint): string {
  const s = scaled.toString().padStart(13, '0');
  const fraction = s.slice(-12).replace(/0+$/, '');
  return fraction ? `${s.slice(0, -12)}.${fraction}` : s.slice(0, -12);
}
