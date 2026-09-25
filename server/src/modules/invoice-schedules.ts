import {
  createInvoiceScheduleSchema,
  formatAmount,
  invoiceScheduleSchema,
  updateInvoiceScheduleSchema,
  type InvoiceInterval,
  type InvoiceSchedule,
} from '@ovl/shared';
import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { invoiceSchedules, organizations, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso } from '../lib/mappers';
import { currentUser } from '../plugins/auth';
import {
  actsFor,
  announceInvoice,
  describeParties,
  financeOrgIds,
  invoiceLines,
  issueInvoice,
  issuerOf,
  recipientOf,
  resolveParties,
  today,
  type InvoiceRow,
} from './invoices';

type ScheduleRow = typeof invoiceSchedules.$inferSelect;

const MONTHS: Record<InvoiceInterval, number> = { weekly: 0, monthly: 1, quarterly: 3, yearly: 12 };

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + days);
  return toDay(d);
}

/**
 * The day of the `n`-th invoice (0 is the first), counted from the start so months never drift:
 * a schedule started on 31 January bills on 28/29 February, 31 March, 30 April…
 */
export function nthRun(startDate: string, interval: InvoiceInterval, n: number): string {
  if (interval === 'weekly') return addDays(startDate, 7 * n);
  const start = toDate(startDate);
  const months = start.getUTCMonth() + MONTHS[interval] * n;
  const year = start.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDay(new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay))));
}

async function partiesActive(tx: Db, row: ScheduleRow): Promise<boolean> {
  for (const party of [issuerOf(row), recipientOf(row)]) {
    const [active] =
      party.type === 'user'
        ? await tx.select({ status: users.status }).from(users).where(eq(users.id, party.id))
        : await tx
            .select({ status: organizations.status })
            .from(organizations)
            .where(eq(organizations.id, party.id));
    if (active?.status !== 'active') return false;
  }
  return true;
}

/**
 * Issue the invoices that are due (the scheduler calls this every minute). Each schedule is
 * claimed with SKIP LOCKED, so several server instances never issue the same invoice twice.
 * Periods missed while the issuer or recipient was suspended are skipped, not billed later.
 */
export async function runDueSchedules(
  app: FastifyInstance,
  options: { day?: string; onlyId?: string; limit?: number } = {},
): Promise<InvoiceRow[]> {
  const day = options.day ?? today();
  const issued: InvoiceRow[] = [];
  for (let i = 0; i < (options.limit ?? 200); i++) {
    const outcome = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(invoiceSchedules)
        .where(
          and(
            eq(invoiceSchedules.status, 'active'),
            lte(invoiceSchedules.nextRunOn, day),
            options.onlyId ? eq(invoiceSchedules.id, options.onlyId) : undefined,
          ),
        )
        .orderBy(invoiceSchedules.nextRunOn)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const periods = row.periods + 1;
      const next = nthRun(row.startDate, row.interval, periods);
      const ended = row.endDate !== null && next > row.endDate;
      const invoice = (await partiesActive(tx, row))
        ? await issueInvoice(tx, {
            issuer: issuerOf(row),
            recipient: recipientOf(row),
            currency: row.currency,
            items: row.items,
            total: row.total,
            note: row.note,
            dueDate: addDays(day, row.dueDays),
            createdBy: row.createdBy,
            scheduleId: row.id,
          })
        : null;
      await tx
        .update(invoiceSchedules)
        .set({
          periods,
          nextRunOn: ended ? null : next,
          status: ended ? 'ended' : 'active',
          invoiceCount: row.invoiceCount + (invoice ? 1 : 0),
          lastInvoiceId: invoice?.id ?? row.lastInvoiceId,
        })
        .where(eq(invoiceSchedules.id, row.id));
      return { invoice };
    });
    if (!outcome) break;
    if (outcome.invoice) {
      issued.push(outcome.invoice);
      await announceInvoice(app, outcome.invoice);
    }
  }
  return issued;
}

async function scheduleDtos(db: Db, rows: ScheduleRow[]): Promise<InvoiceSchedule[]> {
  if (!rows.length) return [];
  const party = await describeParties(
    db,
    rows.flatMap((r) => [issuerOf(r), recipientOf(r)]),
  );
  const creators = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(
      inArray(
        users.id,
        rows.map((r) => r.createdBy),
      ),
    );
  const creator = new Map(creators.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id,
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
    note: r.note,
    interval: r.interval,
    dueDays: r.dueDays,
    startDate: r.startDate,
    endDate: r.endDate,
    nextRunOn: r.status === 'ended' ? null : r.nextRunOn,
    status: r.status,
    invoiceCount: r.invoiceCount,
    lastInvoiceId: r.lastInvoiceId,
    createdBy: creator.get(r.createdBy) ?? { id: r.createdBy, username: '', displayName: '' },
    createdAt: iso(r.createdAt),
  }));
}

export async function invoiceScheduleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['invoices'];

  app.scheduler.add({ name: 'recurring-invoices', everySeconds: 60, run: () => runDueSchedules(app) });

  /** Schedules this person manages: their own and their companies' (finance roles). */
  const managedBy = async (userId: string) => {
    const orgIds = await financeOrgIds(app.db, userId);
    return {
      orgIds,
      where: or(
        eq(invoiceSchedules.issuerUserId, userId),
        orgIds.length ? inArray(invoiceSchedules.issuerOrgId, orgIds) : sql`false`,
      )!,
    };
  };

  app.get(
    '/invoice-schedules',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Recurring invoices you (or your companies) send.',
        response: { 200: z.array(invoiceScheduleSchema) },
      },
    },
    async (req) => {
      const { where } = await managedBy(currentUser(req).id);
      const rows = await app.db
        .select()
        .from(invoiceSchedules)
        .where(where)
        .orderBy(desc(invoiceSchedules.createdAt))
        .limit(200);
      return scheduleDtos(app.db, rows);
    },
  );

  app.post(
    '/invoice-schedules',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description:
          'Invoice someone every week, month, quarter or year. The first invoice goes out on the start ' +
          'date (at once for today); each is due `dueDays` later.',
        body: createInvoiceScheduleSchema,
        response: { 201: invoiceScheduleSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const input = req.body;
      const { issuer, recipient } = await resolveParties(app.db, me.id, input);
      if (input.startDate < today()) throw badRequest('The start date is in the past');
      if (input.endDate && input.endDate < input.startDate)
        throw badRequest('The end date is before the start');
      const { items, total } = invoiceLines(input.items, input.currency);
      const [row] = await app.db
        .insert(invoiceSchedules)
        .values({
          issuerType: issuer.type,
          issuerUserId: issuer.type === 'user' ? issuer.id : null,
          issuerOrgId: issuer.type === 'organization' ? issuer.id : null,
          recipientType: recipient.type,
          recipientUserId: recipient.type === 'user' ? recipient.id : null,
          recipientOrgId: recipient.type === 'organization' ? recipient.id : null,
          currency: input.currency,
          items,
          total,
          note: input.note ?? '',
          interval: input.interval,
          dueDays: input.dueDays,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          nextRunOn: input.startDate,
          createdBy: me.id,
        })
        .returning();
      await audit(app.db, {
        actorId: me.id,
        action: 'invoice_schedule.create',
        targetType: issuer.type,
        targetId: issuer.id,
        data: {
          interval: input.interval,
          total: formatAmount(total, input.currency),
          currency: input.currency,
        },
        ip: req.ip,
      });
      if (input.startDate === today()) await runDueSchedules(app, { onlyId: row!.id });
      const [fresh] = await app.db.select().from(invoiceSchedules).where(eq(invoiceSchedules.id, row!.id));
      return reply.status(201).send((await scheduleDtos(app.db, [fresh!]))[0]!);
    },
  );

  app.patch(
    '/invoice-schedules/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags,
        description: 'Pause, resume (missed periods are skipped) or end a recurring invoice.',
        params: z.object({ id: z.uuid() }),
        body: updateInvoiceScheduleSchema,
        response: { 200: invoiceScheduleSchema },
      },
    },
    async (req) => {
      const me = currentUser(req);
      const { orgIds } = await managedBy(me.id);
      const row = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(invoiceSchedules)
          .where(eq(invoiceSchedules.id, req.params.id))
          .for('update');
        if (!row) throw notFound('Recurring invoice');
        if (!actsFor(issuerOf(row), me.id, orgIds)) throw forbidden('Only the issuer manages this');
        if (row.status === 'ended') throw conflict('This recurring invoice has ended');
        const status = req.body.status;
        const patch: Partial<ScheduleRow> = { status };
        if (status === 'ended') patch.nextRunOn = null;
        if (status === 'active' && row.status === 'paused') {
          let periods = row.periods;
          while (nthRun(row.startDate, row.interval, periods) < today()) periods++;
          const next = nthRun(row.startDate, row.interval, periods);
          patch.periods = periods;
          patch.nextRunOn = next;
          if (row.endDate && next > row.endDate) Object.assign(patch, { status: 'ended', nextRunOn: null });
        }
        const [updated] = await tx
          .update(invoiceSchedules)
          .set(patch)
          .where(eq(invoiceSchedules.id, row.id))
          .returning();
        await audit(tx, {
          actorId: me.id,
          action: `invoice_schedule.${status === 'active' ? 'resume' : status === 'paused' ? 'pause' : 'end'}`,
          targetType: row.issuerType,
          targetId: issuerOf(row).id,
          data: { scheduleId: row.id },
          ip: req.ip,
        });
        return updated!;
      });
      if (row.status === 'active' && row.nextRunOn === today())
        await runDueSchedules(app, { onlyId: row.id });
      const [fresh] = await app.db.select().from(invoiceSchedules).where(eq(invoiceSchedules.id, row.id));
      return (await scheduleDtos(app.db, [fresh!]))[0]!;
    },
  );
}
