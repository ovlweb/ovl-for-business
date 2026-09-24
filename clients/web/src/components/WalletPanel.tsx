import type { Wallet } from '@ovl/shared';
import { CURRENCIES } from '@ovl/shared';
import { Empty, ErrorAlert, Field, formatDate, formatMoney, humanize, Modal, Money, Spinner } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';

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
    <div className="grid-3">
      {wallets.map((w) => (
        <button
          key={w.id}
          className="card stack-sm"
          style={{
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            borderColor: w.id === selected ? 'var(--accent)' : undefined,
            boxShadow: w.id === selected ? '0 0 0 3px var(--accent-soft)' : undefined,
          }}
          onClick={() => onSelect(w.id)}
        >
          <div className="spread">
            <span className="badge info">{w.currency}</span>
            {w.frozen !== '0' && Number(w.frozen) > 0 && (
              <span className="small muted row" style={{ gap: 4 }}>
                <Icon name="lock" size={13} /> {formatMoney(w.frozen, w.currency, false)} frozen
              </span>
            )}
          </div>
          <div className="kpi-value num" style={{ fontSize: 22, fontWeight: 700 }}>
            {formatMoney(w.balance, w.currency, false)}
          </div>
          <div className="small muted">Available: {formatMoney(w.available, w.currency)}</div>
        </button>
      ))}
    </div>
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

  return (
    <div className="stack">
      {!!locks.data?.length && (
        <div className="card flat stack-sm">
          <h3>Frozen funds</h3>
          <p className="small muted">
            Part of every stock investment stays frozen on the business balance until its unlock date.
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
                  <td>{formatDate(l.unlocksAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card pad-0">
        <div className="card-header" style={{ padding: '16px 18px 0' }}>
          <h3>Statement · {wallet.currency}</h3>
          <span className="small muted">{entries.data?.total ?? 0} operations</span>
        </div>
        {entries.isLoading && <Spinner center />}
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
    </div>
  );
}

export function TransferModal({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
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
