import {
  createVirtualCurrencySchema,
  CURRENCIES,
  currencyInfoSchema,
  formatAmount,
  ISO_CURRENCY_CODES,
  issueCurrencySchema,
  parseAmount,
  registerCurrencies,
  virtualCurrencySchema,
  type VirtualCurrency,
} from '@ovl/shared';
import { and, count, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { organizationMembers, registryEntries, virtualCurrencies, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import { currentUser, type AuthUser } from '../plugins/auth';
import { emitRegistryEvent } from './registry';
import { walletAudience } from './wallets/routes';
import { assertWalletAccess, credit, debit, getOrCreateWallet, type WalletRow } from './wallets/service';
import { text } from '../lib/i18n';

type CurrencyRow = typeof virtualCurrencies.$inferSelect;
type EntryRow = typeof registryEntries.$inferSelect;

const REFRESH_MS = 30_000;
let loadedAt = 0;

/** Teach the shared currency table about virtual currencies (decimals, names). */
export async function loadVirtualCurrencies(db: Db) {
  const rows = await db.select().from(virtualCurrencies);
  registerCurrencies(rows.map((r) => ({ code: r.code, name: r.name, decimals: r.decimals, virtual: true })));
  loadedAt = Date.now();
}

/** Other instances may have added currencies: refresh now and then (cheap, one small table). */
export async function refreshVirtualCurrencies(db: Db) {
  if (Date.now() - loadedAt > REFRESH_MS) await loadVirtualCurrencies(db);
}

const holderOf = (entry: EntryRow) =>
  entry.holderUserId
    ? ({ type: 'user', id: entry.holderUserId } as const)
    : ({ type: 'organization', id: entry.holderOrganizationId! } as const);

/** The holder of a virtual country, or its company's owner or a director, manages its currency. */
async function assertManager(db: Db, entry: EntryRow, user: AuthUser) {
  if (entry.holderUserId === user.id) return;
  if (entry.holderOrganizationId) {
    const [member] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, entry.holderOrganizationId),
          eq(organizationMembers.userId, user.id),
        ),
      );
    if (member?.role === 'owner' || member?.role === 'director') return;
  }
  throw forbidden('Only the holder of the virtual country manages its currency');
}

async function currencyDto(db: Db, row: CurrencyRow): Promise<VirtualCurrency> {
  const [entry] = await db.select().from(registryEntries).where(eq(registryEntries.id, row.registryEntryId));
  const [holders] = await db
    .select({ n: count() })
    .from(wallets)
    .where(and(eq(wallets.currency, row.code), gt(wallets.balance, 0n)));
  const holder = holderOf(entry!);
  const [issuerWallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(
      and(
        eq(wallets.currency, row.code),
        holder.type === 'user' ? eq(wallets.userId, holder.id) : eq(wallets.organizationId, holder.id),
      ),
    );
  return {
    code: row.code,
    name: row.name,
    decimals: row.decimals,
    status: row.status,
    registryEntryId: row.registryEntryId,
    registryNumber: entry!.number,
    country: entry!.title,
    supply: formatAmount(row.supply, row.code),
    holders: holders?.n ?? 0,
    issuerWalletId: issuerWallet?.id ?? null,
    createdAt: iso(row.createdAt),
  };
}

export async function virtualCurrencyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['currencies'];

  const load = async (db: Db, code: string, lock = false) => {
    const query = db.select().from(virtualCurrencies).where(eq(virtualCurrencies.code, code.toUpperCase()));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound('Currency');
    const [entry] = await db
      .select()
      .from(registryEntries)
      .where(eq(registryEntries.id, row.registryEntryId));
    return { row, entry: entry! };
  };
  const announce = async (wallet: WalletRow) =>
    app.hub.sendToUsers(await walletAudience(app.db, wallet), {
      type: 'wallet.updated',
      walletId: wallet.id,
    });

  app.get(
    '/currencies',
    {
      schema: {
        tags,
        security: [],
        description:
          'Every currency balances can hold: ISO 4217, and currencies issued by virtual countries.',
        response: { 200: z.array(currencyInfoSchema) },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          c: virtualCurrencies,
          number: registryEntries.number,
          title: registryEntries.title,
          status: registryEntries.status,
        })
        .from(virtualCurrencies)
        .innerJoin(registryEntries, eq(registryEntries.id, virtualCurrencies.registryEntryId));
      return [
        ...CURRENCIES.filter((c) => ISO_CURRENCY_CODES.has(c.code)).map((c) => ({
          code: c.code,
          name: c.name,
          decimals: c.decimals,
          virtual: false,
          issuer: null,
        })),
        ...rows.map((r) => ({
          code: r.c.code,
          name: r.c.name,
          decimals: r.c.decimals,
          virtual: true,
          issuer: {
            registryNumber: r.number,
            country: r.title,
            status: r.c.status === 'active' ? r.status : 'suspended',
          },
        })),
      ];
    },
  );

  app.get(
    '/virtual-currencies/:code',
    {
      schema: {
        tags,
        security: [],
        description: 'A virtual currency with its supply (issued minus redeemed), in public.',
        params: z.object({ code: z.string().length(3) }),
        response: { 200: virtualCurrencySchema },
      },
    },
    async (req) => currencyDto(app.db, (await load(app.db, req.params.code)).row),
  );

  app.post(
    '/registry/:id/currency',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Issue a currency for a virtual country you hold: a three-letter code that is not an ISO 4217 ' +
          'currency. Balances anywhere on the platform can then hold it.',
        params: z.object({ id: z.uuid() }),
        body: createVirtualCurrencySchema,
        response: { 201: virtualCurrencySchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const [entry] = await app.db
        .select()
        .from(registryEntries)
        .where(eq(registryEntries.id, req.params.id));
      if (!entry || entry.kind !== 'virtual_country') throw notFound('Virtual country');
      await assertManager(app.db, entry, me);
      if (entry.status !== 'active') throw conflict(text`This virtual country is ${entry.status}`);
      const { code, name, decimals } = req.body;
      if (ISO_CURRENCY_CODES.has(code))
        throw badRequest(text`${code} is an ISO 4217 currency; pick another code`);
      const row = await app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ code: virtualCurrencies.code })
          .from(virtualCurrencies)
          .where(eq(virtualCurrencies.registryEntryId, entry.id));
        if (existing) throw conflict(text`This virtual country already issues ${existing.code}`);
        const [taken] = await tx.select().from(virtualCurrencies).where(eq(virtualCurrencies.code, code));
        if (taken) throw conflict(text`${code} is already taken`);
        const [row] = await tx
          .insert(virtualCurrencies)
          .values({ code, name, decimals, registryEntryId: entry.id, createdBy: me.id })
          .returning();
        await emitRegistryEvent(tx, 'registry.updated', entry.id);
        await audit(tx, {
          actorId: me.id,
          action: 'currency.create',
          targetType: 'registry_entry',
          targetId: entry.id,
          data: { code, name, decimals },
          ip: req.ip,
        });
        return row!;
      });
      registerCurrencies([{ code, name, decimals, virtual: true }]);
      await getOrCreateWallet(app.db, holderOf(entry), code);
      return reply.status(201).send(await currencyDto(app.db, row));
    },
  );

  const supplyChange = (action: 'issue' | 'redeem') =>
    app.post(
      `/virtual-currencies/:code/${action}`,
      {
        preHandler: app.authenticate,
        schema: {
          tags,
          description:
            action === 'issue'
              ? "Put new money into circulation: it lands on the virtual country holder's balance."
              : "Take money out of circulation from the holder's balance.",
          params: z.object({ code: z.string().length(3) }),
          body: issueCurrencySchema,
          response: { 200: virtualCurrencySchema },
        },
      },
      async (req) => {
        const me = currentUser(req);
        const { row, wallet } = await app.db.transaction(async (tx) => {
          const { row, entry } = await load(tx, req.params.code, true);
          await assertManager(tx, entry, me);
          if (action === 'issue' && (entry.status !== 'active' || row.status !== 'active'))
            throw conflict('Issuing is paused: the virtual country or its currency is not active');
          const amount = parseAmount(req.body.amount, row.code);
          if (amount <= 0n) throw badRequest('Amount must be positive');
          const wallet = await getOrCreateWallet(tx, holderOf(entry), row.code);
          await assertWalletAccess(tx, wallet, me, true);
          const note = req.body.note ? ` — ${req.body.note}` : '';
          const options = { actorId: me.id, referenceType: 'currency', referenceId: row.code };
          if (action === 'issue')
            await credit(tx, wallet.id, amount, 'issuance', {
              ...options,
              description: `Issued by ${entry.title}${note}`,
            });
          else
            await debit(tx, wallet.id, amount, 'redemption', {
              ...options,
              description: `Redeemed by ${entry.title}${note}`,
            });
          const [updated] = await tx
            .update(virtualCurrencies)
            .set({ supply: action === 'issue' ? row.supply + amount : row.supply - amount })
            .where(eq(virtualCurrencies.code, row.code))
            .returning();
          await audit(tx, {
            actorId: me.id,
            action: `currency.${action}`,
            targetType: 'registry_entry',
            targetId: entry.id,
            data: { code: row.code, amount: formatAmount(amount, row.code) },
            ip: req.ip,
          });
          return { row: updated!, wallet };
        });
        await announce(wallet);
        return currencyDto(app.db, row);
      },
    );
  supplyChange('issue');
  supplyChange('redeem');

  app.patch(
    '/admin/virtual-currencies/:code',
    {
      preHandler: app.requirePermission('registry.manage'),
      schema: {
        tags: ['admin'],
        description: 'Suspend a virtual currency (no new issuance; balances keep working) or resume it.',
        params: z.object({ code: z.string().length(3) }),
        body: z.object({ status: z.enum(['active', 'suspended']) }),
        response: { 200: virtualCurrencySchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { row } = await load(app.db, req.params.code);
      const [updated] = await app.db
        .update(virtualCurrencies)
        .set({ status: req.body.status })
        .where(eq(virtualCurrencies.code, row.code))
        .returning();
      await audit(app.db, {
        actorId: me.id,
        action: 'currency.status',
        targetType: 'currency',
        targetId: row.code,
        data: req.body,
        ip: req.ip,
      });
      return currencyDto(app.db, updated!);
    },
  );
}
