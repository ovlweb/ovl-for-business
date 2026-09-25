import {
  formatAmount,
  ORG_FINANCE_ROLES,
  parseAmount,
  payrollInputSchema,
  payrollRunSchema,
  type PayrollRun,
} from '@ovl/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { organizations, payrollRuns, users, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso, isoOrNull } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import { announceApproval, needsSecondSignature, requestSecondSignature } from './org-payments';
import { walletAudience } from './wallets/routes';
import {
  assertWalletAccess,
  credit,
  debit,
  getOrCreateWallet,
  orgRoleOf,
  type WalletRow,
} from './wallets/service';
import { text } from '../lib/i18n';

type RunRow = typeof payrollRuns.$inferSelect;

async function runDtos(db: Db, rows: RunRow[]): Promise<PayrollRun[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.createdBy, ...r.items.map((i) => i.userId)]))];
  const people = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  const person = new Map(people.map((p) => [p.id, p]));
  const ref = (id: string) => person.get(id) ?? { id, username: '', displayName: '' };
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    walletId: r.walletId,
    currency: r.currency,
    title: r.title,
    total: formatAmount(r.total, r.currency),
    status: r.status,
    items: r.items.map((i) => ({
      user: ref(i.userId),
      amount: formatAmount(BigInt(i.amount), r.currency),
      note: i.note,
    })),
    approvalId: r.approvalId,
    createdBy: ref(r.createdBy),
    createdAt: iso(r.createdAt),
    paidAt: isoOrNull(r.paidAt),
  }));
}

/** Pay everyone on a run from the company balance; call inside a transaction. */
async function executePayroll(tx: Db, run: RunRow, actorId: string): Promise<WalletRow[]> {
  const [org] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, run.organizationId));
  const reference = { actorId, referenceType: 'payroll', referenceId: run.id };
  await debit(tx, run.walletId, run.total, 'payroll_out', {
    ...reference,
    description: `Payroll: ${run.title} (${run.items.length} ${run.items.length === 1 ? 'person' : 'people'})`,
  });
  const touched: WalletRow[] = [];
  for (const item of run.items) {
    const wallet = await getOrCreateWallet(tx, { type: 'user', id: item.userId }, run.currency);
    await credit(tx, wallet.id, BigInt(item.amount), 'payroll_in', {
      ...reference,
      description: `${org?.name ?? 'Payroll'}: ${run.title}${item.note ? ` — ${item.note}` : ''}`,
      counterpartyWalletId: run.walletId,
    });
    touched.push(wallet);
  }
  await tx.update(payrollRuns).set({ status: 'paid', paidAt: new Date() }).where(eq(payrollRuns.id, run.id));
  return touched;
}

/** The second signature arrived (see org-payments). */
export async function approvePayrollRun(tx: Db, runId: string, actorId: string): Promise<WalletRow[]> {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for('update');
  if (!run) throw notFound('Payroll run');
  if (run.status !== 'pending') throw conflict(text`This payroll run is already ${run.status}`);
  return executePayroll(tx, run, actorId);
}

/** The payment was declined or withdrawn. */
export async function releasePayrollRun(tx: Db, runId: string) {
  await tx
    .update(payrollRuns)
    .set({ status: 'rejected' })
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, 'pending')));
}

export async function payrollRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['organizations'];
  app.addHook('preHandler', app.authenticate);

  const requireFinance = async (orgId: string, userId: string) => {
    const role = await orgRoleOf(app.db, orgId, userId);
    if (!role || !ORG_FINANCE_ROLES.includes(role))
      throw forbidden('Only owners, directors and accountants handle payroll');
  };

  app.get(
    '/organizations/:id/payroll',
    {
      schema: {
        tags,
        description: 'Payroll runs of the company, newest first.',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.array(payrollRunSchema) },
      },
    },
    async (req) => {
      await requireFinance(req.params.id, currentUser(req).id);
      const rows = await app.db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.organizationId, req.params.id))
        .orderBy(desc(payrollRuns.createdAt))
        .limit(50);
      return runDtos(app.db, rows);
    },
  );

  app.post(
    '/organizations/:id/payroll',
    {
      schema: {
        tags,
        description:
          'Pay up to 200 people from a company balance in one go. Each person receives the amount on their ' +
          'personal balance in that currency. At or above the approval limit the run waits for a second ' +
          'signature (202, status "pending").',
        params: z.object({ id: z.uuid() }),
        body: payrollInputSchema,
        response: { 201: payrollRunSchema, 202: payrollRunSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const input = req.body;
      await requireFinance(req.params.id, me.id);
      const [wallet] = await app.db.select().from(wallets).where(eq(wallets.id, input.walletId));
      if (!wallet || wallet.organizationId !== req.params.id) throw notFound('Company balance');
      await assertWalletAccess(app.db, wallet, me, true);

      const usernames = input.items.map((i) => i.username.toLowerCase());
      if (new Set(usernames).size !== usernames.length) throw badRequest('Each person can appear only once');
      const people = await app.db
        .select({ id: users.id, username: users.username, status: users.status })
        .from(users)
        .where(inArray(users.username, usernames));
      const byName = new Map(people.map((p) => [p.username, p]));
      const missing = usernames.filter((u) => byName.get(u)?.status !== 'active');
      if (missing.length)
        throw badRequest(text`Unknown or suspended: ${missing.map((u) => `@${u}`).join(', ')}`);
      const items = input.items.map((i) => {
        const amount = parseAmount(i.amount, wallet.currency);
        if (amount <= 0n) throw badRequest('Every amount must be positive');
        return {
          userId: byName.get(i.username.toLowerCase())!.id,
          amount: amount.toString(),
          note: i.note ?? '',
        };
      });
      const total = items.reduce((sum, i) => sum + BigInt(i.amount), 0n);

      const outcome = await app.db.transaction(async (tx) => {
        const second = await needsSecondSignature(tx, wallet, total);
        const [run] = await tx
          .insert(payrollRuns)
          .values({
            organizationId: req.params.id,
            walletId: wallet.id,
            currency: wallet.currency,
            title: input.title,
            total,
            status: 'pending',
            items,
            createdBy: me.id,
          })
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: 'payroll.create',
          targetType: 'organization',
          targetId: req.params.id,
          data: {
            people: items.length,
            total: formatAmount(total, wallet.currency),
            currency: wallet.currency,
          },
          ip: req.ip,
        });
        if (second) {
          const approval = await requestSecondSignature(tx, {
            wallet,
            kind: 'payroll',
            action: { payrollRunId: run!.id },
            amount: total,
            description: `Payroll “${input.title}”: ${items.length} ${items.length === 1 ? 'person' : 'people'}`,
            requestedBy: me.id,
            ip: req.ip,
          });
          await tx.update(payrollRuns).set({ approvalId: approval.id }).where(eq(payrollRuns.id, run!.id));
          return { runId: run!.id, approval };
        }
        return { runId: run!.id, paid: await executePayroll(tx, run!, me.id) };
      });

      const [row] = await app.db.select().from(payrollRuns).where(eq(payrollRuns.id, outcome.runId));
      const finance = await walletAudience(app.db, wallet);
      app.hub.sendToUsers(finance, {
        type: 'payroll.updated',
        organizationId: row!.organizationId,
        runId: row!.id,
        status: row!.status,
      });
      if (outcome.approval) {
        await announceApproval(app, outcome.approval);
        return reply.status(202).send((await runDtos(app.db, [row!]))[0]!);
      }
      app.hub.sendToUsers(finance, { type: 'wallet.updated', walletId: wallet.id });
      for (const w of outcome.paid!)
        app.hub.sendToUsers([w.userId!], { type: 'wallet.updated', walletId: w.id });
      return reply.status(201).send((await runDtos(app.db, [row!]))[0]!);
    },
  );
}
