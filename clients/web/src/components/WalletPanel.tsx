import type { CashRequest, Wallet } from '@ovl/shared';
import { CURRENCIES } from '@ovl/shared';
import {
  AnimatedNumber,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  formatMoney,
  humanize,
  Modal,
  Money,
  plural,
  Segmented,
  StatusBadge,
  ShareBar,
  SkeletonList,
  Stagger,
  StaggerItem,
  useToast,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #1e3a8a 0%, #2563eb 55%, #7c3aed 100%)',
  'linear-gradient(135deg, #064e3b 0%, #059669 60%, #0ea5e9 100%)',
  'linear-gradient(135deg, #312e81 0%, #7c3aed 55%, #db2777 100%)',
  'linear-gradient(135deg, #7c2d12 0%, #ea580c 55%, #f59e0b 100%)',
  'linear-gradient(135deg, #0f172a 0%, #334155 60%, #64748b 100%)',
  'linear-gradient(135deg, #134e4a 0%, #0d9488 55%, #22d3ee 100%)',
];

// Familiar currencies get a fixed look so a wallet with several of them never repeats a colour.
const CURRENCY_CARD: Record<string, number> = { EUR: 0, USD: 1, GBP: 4, JPY: 3, CHF: 2, CNY: 3, RUB: 5 };

function cardGradient(currency: string): string {
  const fixed = CURRENCY_CARD[currency];
  if (fixed !== undefined) return CARD_GRADIENTS[fixed]!;
  let hash = 0;
  for (const c of currency) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length]!;
}

/** Balances as bank cards; the frozen part of each balance shows as a split bar. */
export function WalletCards({
  wallets,
  selected,
  onSelect,
}: {
  wallets: Wallet[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Stagger className="card-grid" gap={0.07}>
      {wallets.map((w) => {
        const frozen = Number(w.frozen);
        return (
          <StaggerItem key={w.id}>
            <button
              className={`bank-card${w.id === selected ? ' selected' : ''}`}
              style={{ background: cardGradient(w.currency), width: '100%' }}
              onClick={() => onSelect(w.id)}
              aria-pressed={w.id === selected}
            >
              <div className="spread">
                <span className="bc-currency">{w.currency}</span>
                {frozen > 0 && (
                  <span className="small row" style={{ gap: 4, opacity: 0.9 }}>
                    <Icon name="lock" size={13} /> {formatMoney(w.frozen, w.currency, false)} frozen
                  </span>
                )}
              </div>
              <span className="bc-amount">
                <AnimatedNumber value={w.balance} format={(v) => formatMoney(v, w.currency, false)} />
              </span>
              {frozen > 0 && (
                <ShareBar
                  parts={[
                    { label: 'Available', value: Number(w.available), color: 'rgba(255,255,255,0.9)' },
                    { label: 'Frozen', value: frozen, color: 'rgba(255,255,255,0.35)' },
                  ]}
                />
              )}
              <span className="bc-meta">
                <span>Available: {formatMoney(w.available, w.currency)}</span>
                <Icon name="card" size={16} />
              </span>
            </button>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

export function OpenWalletForm({ onOpen }: { onOpen: (currency: string) => Promise<unknown> }) {
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="row-wrap"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await onOpen(currency);
        } catch (err) {
          setError(err);
        }
      }}
    >
      <select
        className="select"
        style={{ width: 280 }}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </select>
      <button className="btn">Open balance</button>
      <ErrorAlert error={error} />
    </form>
  );
}

export function Statement({ wallet }: { wallet: Wallet }) {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const entries = useQuery({
    queryKey: ['entries', wallet.id, offset],
    queryFn: () => api.wallets.entries(wallet.id, { limit, offset }),
  });
  const locks = useQuery({
    queryKey: ['wallet', wallet.id, 'locks'],
    queryFn: () => api.wallets.locks(wallet.id),
  });
  const [exporting, setExporting] = useState(false);

  return (
    <div className="stack">
      {!!locks.data?.length && (
        <div className="card flat stack-sm">
          <h3>Frozen funds</h3>
          <p className="small muted">
            Money set aside for payouts you asked for, and the part of every stock investment that stays
            frozen on a business balance until its unlock date.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Reason</th>
                <th>Unlocks</th>
              </tr>
            </thead>
            <tbody>
              {locks.data.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Money amount={l.amount} currency={l.currency} />
                  </td>
                  <td>{humanize(l.reason)}</td>
                  <td>
                    {l.reason === 'withdrawal_request' ? 'When paid out' : formatDate(l.unlocksAt, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card pad-0">
        <div className="card-header" style={{ padding: '16px 18px 0' }}>
          <h3>Statement · {wallet.currency}</h3>
          <div className="row" style={{ gap: 10 }}>
            <span className="small muted">{plural(entries.data?.total ?? 0, 'operation')}</span>
            <button className="btn sm" onClick={() => setExporting(true)} disabled={!entries.data?.total}>
              <Icon name="download" size={15} /> Export CSV
            </button>
          </div>
        </div>
        {entries.isLoading && <SkeletonList rows={4} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Operation</th>
                <th className="right">Amount</th>
                <th className="right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.data?.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap small">{formatDate(e.createdAt)}</td>
                  <td>
                    <div className="bold small">{humanize(e.kind)}</div>
                    <div className="small muted">{e.description}</div>
                  </td>
                  <td className={`right ${e.amount.startsWith('-') ? 'neg' : 'pos'}`}>
                    <Money amount={e.amount} currency={e.currency} />
                  </td>
                  <td className="right">
                    <Money amount={e.balanceAfter} currency={e.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.data?.items.length === 0 && <Empty title="No operations yet" />}
        {entries.data && entries.data.total > limit && (
          <div className="spread" style={{ padding: 12 }}>
            <button
              className="btn sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Newer
            </button>
            <span className="small muted">
              {offset + 1}–{Math.min(offset + limit, entries.data.total)} of {entries.data.total}
            </span>
            <button
              className="btn sm"
              disabled={offset + limit >= entries.data.total}
              onClick={() => setOffset(offset + limit)}
            >
              Older
            </button>
          </div>
        )}
      </div>
      {exporting && <ExportModal wallet={wallet} onClose={() => setExporting(false)} />}
    </div>
  );
}

type Period = 'month' | 'last_month' | 'year' | 'all';

function periodRange(period: Period, now = new Date()): { from?: string; to?: string } {
  const day = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'month':
      return { from: day(new Date(y, m, 1)) };
    case 'last_month':
      return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) };
    case 'year':
      return { from: day(new Date(y, 0, 1)) };
    case 'all':
      return {};
  }
}

/** Save a file the SDK fetched (object URL + a temporary link). */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportModal({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('month');
  const download = useMutation({
    mutationFn: () => api.wallets.statementCsv(wallet.id, periodRange(period)),
    onSuccess: ({ blob, filename }) => {
      saveFile(blob, filename ?? `ovl-statement-${wallet.currency.toLowerCase()}.csv`);
      toast.success('Statement downloaded');
      onClose();
    },
  });
  return (
    <Modal title={`Export ${wallet.currency} statement`} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          A CSV file for spreadsheets and accounting software: date, operation, description, amount and the
          balance after each operation.
        </p>
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'last_month', label: 'Last month' },
            { value: 'year', label: 'This year' },
            { value: 'all', label: 'All time' },
          ]}
        />
        <ErrorAlert error={download.error} />
        <button className="btn primary" onClick={() => download.mutate()} disabled={download.isPending}>
          {download.isPending ? <span className="spinner light" /> : <Icon name="download" size={16} />}
          Download CSV
        </button>
      </div>
    </Modal>
  );
}

const METHOD_LABEL = { manager_transfer: 'Bank transfer', physical_cash: 'Cash desk' } as const;

/** Ask a finance manager for a deposit or a payout. */
export function CashRequestModal({
  wallet,
  type,
  onClose,
}: {
  wallet: Wallet;
  type: 'deposit' | 'withdrawal';
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    method: 'manager_transfer' as keyof typeof METHOD_LABEL,
    amount: '',
    note: '',
  });
  const deposit = type === 'deposit';
  const send = useMutation({
    mutationFn: () =>
      api.wallets.requestCash(wallet.id, {
        type,
        method: form.method,
        amount: form.amount,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      for (const key of ['cashRequests', 'wallets', 'orgWallets', 'wallet'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(deposit ? 'Deposit requested' : 'Payout requested — the amount is held meanwhile');
      onClose();
    },
  });
  return (
    <Modal title={deposit ? `Deposit ${wallet.currency}` : `Withdraw ${wallet.currency}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          {deposit
            ? 'A finance manager confirms the deposit once the money arrives by bank transfer or is handed in at the cash desk.'
            : 'A finance manager pays the money out by bank transfer or at the cash desk. The amount is held on your balance until then; you can cancel while the request is pending.'}
        </p>
        {!deposit && (
          <div className="alert info">Available: {formatMoney(wallet.available, wallet.currency)}</div>
        )}
        <div className="row">
          {(Object.keys(METHOD_LABEL) as (keyof typeof METHOD_LABEL)[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`chip${form.method === m ? ' active' : ''}`}
              onClick={() => setForm({ ...form, method: m })}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <Field label={`Amount (${wallet.currency})`}>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })}
            autoFocus
            required
          />
        </Field>
        <Field
          label="Note for the finance manager (optional)"
          hint={
            form.method === 'manager_transfer' && !deposit
              ? 'For example, the bank account to pay into.'
              : undefined
          }
        >
          <textarea
            className="textarea"
            rows={3}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            maxLength={1000}
          />
        </Field>
        <ErrorAlert error={send.error} />
        <button className="btn primary" disabled={send.isPending}>
          {deposit ? 'Request deposit' : 'Request payout'}
        </button>
      </form>
    </Modal>
  );
}

function requestDetail(r: CashRequest): string {
  if (r.status === 'completed')
    return `Done by ${r.handledBy?.displayName ?? 'finance'} · ref. ${r.reference}`;
  if (r.status === 'declined') return `Declined: ${r.declineReason}`;
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.awaitingApproval) return 'Being handled · a second finance manager confirms large amounts';
  return r.type === 'withdrawal'
    ? 'Waiting for a finance manager · amount held'
    : 'Waiting for a finance manager';
}

/** Deposit and payout requests for one balance, newest first. Hidden until there is one. */
export function CashRequests({ wallet }: { wallet: Wallet }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ['cashRequests', wallet.id],
    queryFn: () => api.wallets.cashRequests(wallet.id),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.wallets.cancelCashRequest(id),
    onSuccess: () => {
      for (const key of ['cashRequests', 'wallets', 'orgWallets', 'wallet'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success('Request cancelled');
    },
  });
  if (!requests.data?.length) return null;
  return (
    <div className="card stack-sm">
      <div className="card-header">
        <h3>Deposit and payout requests</h3>
        <span className="small muted">
          {plural(requests.data.filter((r) => r.status === 'pending').length, 'pending request')}
        </span>
      </div>
      <ErrorAlert error={cancel.error} />
      <div className="list">
        {requests.data.map((r) => (
          <div key={r.id} className="list-item cash-request">
            <span className={`cr-icon ${r.type}`}>
              <Icon name={r.type === 'deposit' ? 'incoming' : 'outgoing'} size={17} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 8 }}>
                <b>{r.type === 'deposit' ? 'Deposit' : 'Payout'}</b>
                <span className="small muted">
                  {METHOD_LABEL[r.method]} · {formatDate(r.createdAt)}
                </span>
              </div>
              <div className="small muted ellipsis">{requestDetail(r)}</div>
              {r.note && <div className="small ellipsis">“{r.note}”</div>}
            </div>
            <div className="cr-amount">
              <b className={r.type === 'deposit' ? 'pos' : ''}>
                {r.type === 'deposit' ? '+' : '−'}
                <Money amount={r.amount} currency={r.currency} />
              </b>
              <StatusBadge status={r.status} />
            </div>
            {r.status === 'pending' && (
              <button
                className="btn ghost sm"
                onClick={() => cancel.mutate(r.id)}
                disabled={cancel.isPending}
                aria-label="Cancel request"
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TransferModal({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ type: 'user' as 'user' | 'organization', to: '', amount: '', note: '' });
  const transfer = useMutation({
    mutationFn: () =>
      api.wallets.transfer({
        fromWalletId: wallet.id,
        to:
          form.type === 'user'
            ? { type: 'user', username: form.to.replace(/^@/, '') }
            : { type: 'organization', slug: form.to },
        amount: form.amount,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      for (const key of ['wallets', 'orgWallets', 'entries', 'wallet'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(`Sent ${formatMoney(form.amount, wallet.currency)}`);
      onClose();
    },
  });
  return (
    <Modal title={`Send ${wallet.currency}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          transfer.mutate();
        }}
      >
        <div className="alert info">Available: {formatMoney(wallet.available, wallet.currency)}</div>
        <div className="row">
          <button
            type="button"
            className={`chip${form.type === 'user' ? ' active' : ''}`}
            onClick={() => setForm({ ...form, type: 'user' })}
          >
            To a person
          </button>
          <button
            type="button"
            className={`chip${form.type === 'organization' ? ' active' : ''}`}
            onClick={() => setForm({ ...form, type: 'organization' })}
          >
            To a company
          </button>
        </div>
        <Field label={form.type === 'user' ? 'Username' : 'Company handle (slug)'}>
          <input
            className="input"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            required
          />
        </Field>
        <Field label={`Amount (${wallet.currency})`}>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })}
            required
          />
        </Field>
        <Field label="Note (optional)">
          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            maxLength={500}
          />
        </Field>
        <ErrorAlert error={transfer.error} />
        <button className="btn primary" disabled={transfer.isPending}>
          Send
        </button>
      </form>
    </Modal>
  );
}
