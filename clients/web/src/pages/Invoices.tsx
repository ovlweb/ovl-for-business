import {
  CURRENCIES,
  formatAmount,
  ORG_FINANCE_ROLES,
  parseAmount,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceInterval,
  type InvoiceSchedule,
  type Wallet,
} from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  formatMoney,
  Icon,
  Logo,
  Modal,
  Money,
  PageHeader,
  plural,
  Segmented,
  SkeletonList,
  Stagger,
  StaggerItem,
  StatusBadge,
  useToast,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { isPendingApproval } from '../components/WalletPanel';

type Direction = 'incoming' | 'outgoing';
type View = Direction | 'recurring';

const EVERY: Record<InvoiceInterval, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const day = (iso: string) => formatDate(`${iso}T12:00:00`, false);

/** "1,200.00 USD · 80.00 EUR" still due on open invoices, grouped by currency. */
function totals(invoices: Invoice[]): string {
  const by = new Map<string, bigint>();
  for (const i of invoices)
    by.set(i.currency, (by.get(i.currency) ?? 0n) + parseAmount(i.amountDue, i.currency));
  if (by.size === 0) return '—';
  return [...by]
    .map(([currency, minor]) => formatMoney(formatAmount(minor, currency), currency))
    .slice(0, 2)
    .join(' · ')
    .concat(by.size > 2 ? ` +${by.size - 2}` : '');
}

const partlyPaid = (i: Invoice) => i.status === 'open' && Number(i.amountPaid) > 0;

function statusOf(i: Invoice) {
  return i.overdue ? 'overdue' : partlyPaid(i) ? 'partly_paid' : i.status;
}

export function InvoicesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('incoming');
  const direction: Direction = view === 'recurring' ? 'outgoing' : view;
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['invoices', direction, onlyOpen],
    queryFn: () => api.invoices.list({ direction, status: onlyOpen ? 'open' : undefined }),
    enabled: view !== 'recurring',
  });
  const open = useQuery({
    queryKey: ['invoices', 'open'],
    queryFn: () => api.invoices.list({ status: 'open' }),
  });
  const toPay = open.data?.filter((i) => i.direction === 'incoming') ?? [];
  const toReceive = open.data?.filter((i) => i.direction === 'outgoing') ?? [];
  const overdue = toPay.filter((i) => i.overdue).length;

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="receipt"
        title="Invoices"
        subtitle="Bill people and companies, and pay what you are billed — personally or for your companies."
        actions={
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New invoice
          </button>
        }
      />
      <Stagger className="grid-3" gap={0.06}>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="outgoing" size={16} />
            </span>
            To pay
          </span>
          <span className="kpi-value compact">{totals(toPay)}</span>
          <span className="small muted">{plural(toPay.length, 'open invoice')}</span>
        </StaggerItem>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="incoming" size={16} />
            </span>
            To receive
          </span>
          <span className="kpi-value compact">{totals(toReceive)}</span>
          <span className="small muted">{plural(toReceive.length, 'open invoice')}</span>
        </StaggerItem>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="clock" size={16} />
            </span>
            Overdue to pay
          </span>
          <span className={`kpi-value${overdue ? ' neg' : ''}`}>{overdue}</span>
          <span className="small muted">past their due date</span>
        </StaggerItem>
      </Stagger>

      <div className="card pad-0">
        <div className="card-header" style={{ padding: '14px 18px 0', flexWrap: 'wrap', gap: 10 }}>
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: 'incoming', label: 'Received' },
              { value: 'outgoing', label: 'Sent' },
              { value: 'recurring', label: 'Recurring' },
            ]}
          />
          <div className="row" hidden={view === 'recurring'}>
            <button className={`chip${onlyOpen ? ' active' : ''}`} onClick={() => setOnlyOpen(true)}>
              Open
            </button>
            <button className={`chip${!onlyOpen ? ' active' : ''}`} onClick={() => setOnlyOpen(false)}>
              All
            </button>
          </div>
        </div>
        {view === 'recurring' && <Schedules />}
        {view !== 'recurring' && <ErrorAlert error={list.error} />}
        {view !== 'recurring' && list.isLoading && <SkeletonList rows={3} />}
        {view !== 'recurring' && list.data?.length === 0 && (
          <Empty icon="receipt" title={onlyOpen ? 'Nothing open' : 'No invoices yet'}>
            {direction === 'incoming'
              ? 'Invoices people and companies send you appear here.'
              : 'Create an invoice to bill a person or a company.'}
          </Empty>
        )}
        {view !== 'recurring' && !!list.data?.length && (
          <div className="table-wrap">
            <table className="table invoices-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>{direction === 'incoming' ? 'From' : 'To'}</th>
                  <th>Due</th>
                  <th className="right">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((i) => {
                  const other = i.direction === 'incoming' ? i.issuer : i.recipient;
                  const own = i.direction === 'incoming' ? i.recipient : i.issuer;
                  return (
                    <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                      <td>
                        <b className="mono">{i.number}</b>
                        {i.recurring && (
                          <span
                            className="badge info"
                            style={{ marginLeft: 6 }}
                            title={EVERY[i.recurring.interval as InvoiceInterval]}
                          >
                            <Icon name="refresh" size={11} /> Recurring
                          </span>
                        )}
                        <div className="small muted">
                          {own.type === 'organization' ? own.name : 'Personal'} ·{' '}
                          {formatDate(i.createdAt, false)}
                        </div>
                      </td>
                      <td>
                        <b>{other.name}</b>
                        <div className="small muted">{other.handle}</div>
                      </td>
                      <td className={`nowrap small${i.overdue ? ' neg' : ''}`}>{day(i.dueDate)}</td>
                      <td className="right bold">
                        <Money amount={i.total} currency={i.currency} />
                        {partlyPaid(i) && (
                          <div className="small muted">{formatMoney(i.amountDue, i.currency)} due</div>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={statusOf(i)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewInvoiceModal
          onClose={() => setCreating(false)}
          onCreated={(invoiceId, recurring) => {
            setCreating(false);
            setView(recurring ? 'recurring' : 'outgoing');
            if (invoiceId) navigate(`/invoices/${invoiceId}`);
          }}
        />
      )}
      {id && <InvoiceModal id={id} onClose={() => navigate('/invoices')} />}
    </div>
  );
}

/** The invoice itself, as shown on screen and printed. */
function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  return (
    <article className="invoice-doc">
      <header className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10 }}>
          <Logo size={34} />
          <div>
            <div className="invoice-title">Invoice</div>
            <div className="mono small">{invoice.number}</div>
          </div>
        </div>
        <StatusBadge status={statusOf(invoice)} />
      </header>
      <div className="invoice-parties">
        <div>
          <div className="invoice-label">From</div>
          <b>{invoice.issuer.name}</b>
          <div className="small muted">{invoice.issuer.handle}</div>
        </div>
        <div>
          <div className="invoice-label">Bill to</div>
          <b>{invoice.recipient.name}</b>
          <div className="small muted">{invoice.recipient.handle}</div>
        </div>
        <div>
          <div className="invoice-label">Issued</div>
          <b>{formatDate(invoice.createdAt, false)}</b>
          <div className="invoice-label" style={{ marginTop: 8 }}>
            Due
          </div>
          <b className={invoice.overdue ? 'neg' : ''}>{day(invoice.dueDate)}</b>
        </div>
      </div>
      <table className="table invoice-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th className="right">Qty</th>
            <th className="right">Unit price</th>
            <th className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, n) => (
            <tr key={n}>
              <td>{item.description}</td>
              <td className="right">{item.quantity}</td>
              <td className="right nowrap">{formatMoney(item.unitPrice, invoice.currency, false)}</td>
              <td className="right nowrap">{formatMoney(item.amount, invoice.currency, false)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="right bold">
              Total ({invoice.currency})
            </td>
            <td className="right invoice-total nowrap">{formatMoney(invoice.total, invoice.currency)}</td>
          </tr>
          {Number(invoice.amountPaid) > 0 && invoice.status === 'open' && (
            <>
              <tr>
                <td colSpan={3} className="right small">
                  Paid so far
                </td>
                <td className="right nowrap small">{formatMoney(invoice.amountPaid, invoice.currency)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="right bold">
                  Still due
                </td>
                <td className="right nowrap bold">{formatMoney(invoice.amountDue, invoice.currency)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      {invoice.note && <p className="small invoice-note">{invoice.note}</p>}
      {invoice.payments.length > 1 || (invoice.payments.length === 1 && invoice.status === 'open') ? (
        <div className="stack-sm">
          <div className="invoice-label">Payments</div>
          {invoice.payments.map((p) => (
            <div key={p.id} className="spread small">
              <span>
                {formatDate(p.createdAt)} · {p.paidBy.displayName}
              </span>
              <b>{formatMoney(p.amount, invoice.currency)}</b>
            </div>
          ))}
        </div>
      ) : null}
      {invoice.recurring && (
        <p className="tiny muted">
          <Icon name="refresh" size={12} /> Recurring invoice ·{' '}
          {EVERY[invoice.recurring.interval as InvoiceInterval].toLowerCase()}
        </p>
      )}
      <footer className="tiny muted">
        {invoice.status === 'paid' && invoice.paidAt
          ? `Paid on ${formatDate(invoice.paidAt)} by ${invoice.paidBy?.displayName ?? ''}.`
          : invoice.status === 'cancelled'
            ? `Cancelled${invoice.cancelReason ? `: ${invoice.cancelReason}` : ''}.`
            : 'Pay in OVL For Business: Invoices → Pay, from a balance in the invoice currency.'}
      </footer>
    </article>
  );
}

function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const invoice = useQuery({ queryKey: ['invoices', 'one', id], queryFn: () => api.invoices.get(id) });
  const i = invoice.data;
  const payerWallets = useQuery({
    queryKey: i?.recipient.type === 'organization' ? ['orgWallets', i.recipient.id] : ['wallets'],
    queryFn: () =>
      i!.recipient.type === 'organization' ? api.organizations.wallets(i!.recipient.id) : api.wallets.list(),
    enabled: !!i && i.direction === 'incoming' && i.status === 'open',
  });
  const matching = (payerWallets.data ?? []).filter((w: Wallet) => w.currency === i?.currency);
  const [walletId, setWalletId] = useState<string>();
  const wallet = matching.find((w) => w.id === walletId) ?? matching[0];
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  // The printable copy exists only while printing (the button, or Ctrl/⌘ + P).
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const done = (message: string) => {
    for (const key of ['invoices', 'wallets', 'orgWallets', 'entries', 'wallet', 'paymentApprovals'])
      queryClient.invalidateQueries({ queryKey: [key] });
    toast.success(message);
  };
  const [partial, setPartial] = useState(false);
  const [part, setPart] = useState('');
  const pay = useMutation({
    mutationFn: (amount: string) => api.invoices.pay(id, wallet!.id, partial ? amount : undefined),
    onSuccess: (paid, amount) => {
      setPartial(false);
      setPart('');
      isPendingApproval(paid)
        ? done('Above the approval limit: another finance member has to approve this payment')
        : done(`Paid ${formatMoney(amount, paid.currency)} to ${paid.issuer.name}`);
    },
  });
  const payAmount = partial ? part : (i?.amountDue ?? '0');
  const cancel = useMutation({
    mutationFn: () => api.invoices.cancel(id, reason || undefined),
    onSuccess: () => {
      setCancelling(false);
      done('Invoice cancelled');
    },
  });

  return (
    <Modal title={i ? `Invoice ${i.number}` : 'Invoice'} onClose={onClose} wide>
      <ErrorAlert error={invoice.error} />
      {!i && !invoice.error && <SkeletonList rows={4} avatar={false} />}
      {i && (
        <div className="stack">
          <InvoiceDocument invoice={i} />
          {printing &&
            createPortal(
              <div className="print-root">
                <InvoiceDocument invoice={i} />
              </div>,
              document.body,
            )}
          <ErrorAlert error={pay.error ?? cancel.error} />
          {i.direction === 'incoming' && i.status === 'open' && (
            <div className="invoice-pay">
              {matching.length > 0 ? (
                <>
                  <Field label="Pay from">
                    <select
                      className="select"
                      value={wallet?.id}
                      onChange={(e) => setWalletId(e.target.value)}
                      aria-label="Pay from"
                    >
                      {matching.map((w) => (
                        <option key={w.id} value={w.id}>
                          {i.recipient.type === 'organization' ? i.recipient.name : 'Personal'} {w.currency} ·
                          available {formatMoney(w.available, w.currency)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {partial && (
                    <Field label={`Amount to pay now (of ${formatMoney(i.amountDue, i.currency)})`}>
                      <input
                        className="input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={part}
                        autoFocus
                        onChange={(e) => setPart(e.target.value.replace(',', '.'))}
                      />
                    </Field>
                  )}
                  <div className="row-wrap">
                    <button
                      className="btn gradient"
                      disabled={pay.isPending || !wallet || !(Number(payAmount) > 0)}
                      onClick={() => pay.mutate(payAmount)}
                    >
                      {pay.isPending ? <span className="spinner light" /> : <Icon name="check" size={16} />}
                      Pay {Number(payAmount) > 0 ? formatMoney(payAmount, i.currency) : ''}
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => setPartial(!partial)}>
                      {partial ? 'Pay everything instead' : 'Pay part of it'}
                    </button>
                  </div>
                </>
              ) : (
                payerWallets.isSuccess && (
                  <div className="alert info small">
                    <Icon name="info" size={16} />
                    <span>
                      To pay, open a {i.currency} balance and ask for a deposit on the{' '}
                      <Link
                        to={
                          i.recipient.type === 'organization' ? `/companies/${i.recipient.handle}` : '/wallet'
                        }
                      >
                        wallet page
                      </Link>
                      .
                    </span>
                  </div>
                )
              )}
            </div>
          )}
          {cancelling && (
            <Field label="Reason (optional, shown to the recipient)">
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                autoFocus
              />
            </Field>
          )}
          <div className="spread">
            <button className="btn" onClick={() => window.print()}>
              <Icon name="printer" size={16} /> Print or save as PDF
            </button>
            {i.direction === 'outgoing' && i.status === 'open' && !partlyPaid(i) && (
              <button
                className={`btn ${cancelling ? 'danger' : 'ghost'}`}
                disabled={cancel.isPending}
                onClick={() => (cancelling ? cancel.mutate() : setCancelling(true))}
              >
                {cancelling ? 'Cancel invoice' : 'Cancel invoice…'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
}

function NewInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (invoiceId: string | null, recurring: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs', 'mine'], queryFn: api.organizations.mine });
  const issuers = (orgs.data ?? []).filter((o) => o.myRole && ORG_FINANCE_ROLES.includes(o.myRole));
  const [fromChoice, setFrom] = useState<string>();
  const from = fromChoice ?? issuers[0]?.id ?? 'me';
  const [toType, setToType] = useState<'user' | 'organization'>('organization');
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [dueDate, setDueDate] = useState(inDays(14));
  const [repeat, setRepeat] = useState<InvoiceInterval | ''>('');
  const [startDate, setStartDate] = useState(inDays(0));
  const [endDate, setEndDate] = useState('');
  const [dueDays, setDueDays] = useState('14');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: '1', unitPrice: '' }]);

  const total = useMemo(() => {
    try {
      const sum = lines.reduce(
        (acc, l) =>
          acc + parseAmount(l.unitPrice || '0', currency) * BigInt(Math.max(0, parseInt(l.quantity) || 0)),
        0n,
      );
      return formatMoney(formatAmount(sum, currency), currency);
    } catch {
      return '—';
    }
  }, [lines, currency]);

  const create = useMutation({
    mutationFn: async (): Promise<{ invoiceId: string | null; message: string }> => {
      const input: CreateInvoiceInput = {
        from: from === 'me' ? { type: 'user' } : { type: 'organization', organizationId: from },
        to:
          toType === 'user'
            ? { type: 'user', username: to.trim().replace(/^@/, '') }
            : { type: 'organization', slug: to.trim() },
        currency,
        dueDate,
        items: lines.map((l) => ({
          description: l.description,
          quantity: parseInt(l.quantity) || 0,
          unitPrice: l.unitPrice,
        })),
        note: note || undefined,
      };
      if (repeat) {
        const { dueDate: _, ...rest } = input;
        const schedule = await api.invoices.createSchedule({
          ...rest,
          interval: repeat,
          startDate,
          endDate: endDate || undefined,
          dueDays: parseInt(dueDays) || 0,
        });
        return {
          invoiceId: schedule.lastInvoiceId,
          message: schedule.invoiceCount
            ? `First invoice sent to ${schedule.recipient.name}; the next goes out on ${day(schedule.nextRunOn!)}`
            : `Recurring invoice set up: the first goes out on ${day(schedule.startDate)}`,
        };
      }
      const invoice = await api.invoices.create(input);
      return {
        invoiceId: invoice.id,
        message: `Invoice ${invoice.number} sent to ${invoice.recipient.name}`,
      };
    },
    onSuccess: ({ invoiceId, message }) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoiceSchedules'] });
      toast.success(message);
      onCreated(invoiceId, !!repeat);
    },
  });
  const setLine = (n: number, patch: Partial<Line>) =>
    setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));

  return (
    <Modal title="New invoice" onClose={onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid-2">
          <Field label="From">
            <select
              className="select"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From"
            >
              <option value="me">Me (personal)</option>
              {issuers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={toType === 'user' ? 'Bill to (username)' : 'Bill to (company handle)'}>
            <div className="row" style={{ gap: 6 }}>
              <select
                className="select"
                style={{ width: 130 }}
                value={toType}
                onChange={(e) => setToType(e.target.value as 'user' | 'organization')}
                aria-label="Recipient type"
              >
                <option value="organization">Company</option>
                <option value="user">Person</option>
              </select>
              <input
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={toType === 'user' ? 'username' : 'company-handle'}
                aria-label="Recipient"
                required
              />
            </div>
          </Field>
          <Field label="Currency">
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Repeat">
            <select
              className="select"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as InvoiceInterval | '')}
            >
              <option value="">Does not repeat</option>
              {(Object.keys(EVERY) as InvoiceInterval[]).map((k) => (
                <option key={k} value={k}>
                  {EVERY[k]}
                </option>
              ))}
            </select>
          </Field>
          {!repeat && (
            <Field label="Due date">
              <input
                className="input"
                type="date"
                value={dueDate}
                min={inDays(0)}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </Field>
          )}
          {repeat && (
            <>
              <Field label="First invoice on" hint="Today sends the first one at once.">
                <input
                  className="input"
                  type="date"
                  value={startDate}
                  min={inDays(0)}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Payment term (days)" hint="Each invoice is due this many days after it is sent.">
                <input
                  className="input"
                  inputMode="numeric"
                  value={dueDays}
                  onChange={(e) => setDueDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  required
                />
              </Field>
              <Field label="Last invoice by (optional)">
                <input
                  className="input"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        <div className="stack-sm">
          <div className="invoice-line head invoice-label">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price</span>
            <span />
          </div>
          {lines.map((l, n) => (
            <div key={n} className="invoice-line">
              <input
                className="input"
                placeholder="What you are billing for"
                aria-label={`Line ${n + 1} description`}
                value={l.description}
                onChange={(e) => setLine(n, { description: e.target.value })}
                maxLength={200}
                required
              />
              <input
                className="input"
                inputMode="numeric"
                aria-label={`Line ${n + 1} quantity`}
                value={l.quantity}
                onChange={(e) => setLine(n, { quantity: e.target.value.replace(/\D/g, '') })}
                required
              />
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Line ${n + 1} unit price`}
                value={l.unitPrice}
                onChange={(e) => setLine(n, { unitPrice: e.target.value.replace(',', '.') })}
                required
              />
              <button
                type="button"
                className="btn ghost icon sm"
                aria-label={`Remove line ${n + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, i) => i !== n))}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
          <div className="spread">
            <button
              type="button"
              className="btn sm"
              disabled={lines.length >= 50}
              onClick={() => setLines([...lines, { description: '', quantity: '1', unitPrice: '' }])}
            >
              <Icon name="plus" size={14} /> Add line
            </button>
            <span>
              Total <b className="invoice-total">{total}</b>
            </span>
          </div>
        </div>

        <Field label="Note (optional)" hint="Payment terms, order number, thanks…">
          <textarea
            className="textarea"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
        </Field>
        <ErrorAlert error={create.error} />
        <button className="btn primary" disabled={create.isPending}>
          <Icon name={repeat ? 'refresh' : 'send'} size={16} />{' '}
          {repeat ? 'Set up recurring invoice' : 'Send invoice'}
        </button>
      </form>
    </Modal>
  );
}

/** Recurring invoices this person (or their companies) send. */
function Schedules() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const schedules = useQuery({ queryKey: ['invoiceSchedules'], queryFn: api.invoices.schedules });
  const change = useMutation({
    mutationFn: ({ s, status }: { s: InvoiceSchedule; status: 'active' | 'paused' | 'ended' }) =>
      api.invoices.setScheduleStatus(s.id, status),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['invoiceSchedules'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(
        s.status === 'paused'
          ? 'Recurring invoice paused'
          : s.status === 'ended'
            ? 'Recurring invoice ended'
            : `Resumed: the next invoice goes out on ${day(s.nextRunOn!)}`,
      );
    },
  });
  if (schedules.isLoading) return <SkeletonList rows={3} />;
  return (
    <>
      <ErrorAlert error={schedules.error ?? change.error} />
      {schedules.data?.length === 0 && (
        <Empty icon="refresh" title="No recurring invoices">
          Choose “Repeat” on a new invoice to bill someone every week, month, quarter or year.
        </Empty>
      )}
      {!!schedules.data?.length && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>To</th>
                <th>Every</th>
                <th>Next invoice</th>
                <th className="right">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.recipient.name}</b>
                    <div className="small muted">
                      {s.issuer.type === 'organization' ? `From ${s.issuer.name}` : 'Personal'} ·{' '}
                      {plural(s.invoiceCount, 'invoice')} sent
                    </div>
                  </td>
                  <td className="small">{EVERY[s.interval]}</td>
                  <td className="small nowrap">
                    {s.nextRunOn ? day(s.nextRunOn) : '—'}
                    {s.endDate && <div className="muted">until {day(s.endDate)}</div>}
                  </td>
                  <td className="right bold">
                    <Money amount={s.total} currency={s.currency} />
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="right nowrap">
                    {s.status !== 'ended' && (
                      <>
                        <button
                          className="btn ghost sm"
                          disabled={change.isPending}
                          onClick={() =>
                            change.mutate({ s, status: s.status === 'active' ? 'paused' : 'active' })
                          }
                        >
                          {s.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          className="btn ghost sm"
                          disabled={change.isPending}
                          onClick={() => change.mutate({ s, status: 'ended' })}
                        >
                          End
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
