import { CURRENCIES } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  formatMoney,
  humanize,
  Money,
  PageHeader,
  Spinner,
  useDebounced,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAdmin } from '../auth';
import { Pager } from './common';

type Owner = { type: 'user' | 'organization'; id: string; name: string; handle: string };

function OperationForm({ owner }: { owner: Owner }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    type: 'deposit' as 'deposit' | 'withdrawal',
    method: 'physical_cash' as 'physical_cash' | 'manager_transfer',
    currency: 'USD',
    amount: '',
    reference: '',
    note: '',
  });
  const [confirming, setConfirming] = useState(false);
  const submit = useMutation({
    mutationFn: () =>
      api.admin.cashOperation({
        ownerType: owner.type,
        ownerId: owner.id,
        currency: form.currency,
        amount: form.amount,
        type: form.type,
        method: form.method,
        reference: form.reference,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      setConfirming(false);
      setForm({ ...form, amount: '', reference: '', note: '' });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['ownerWallets'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirming) submit.mutate();
        else setConfirming(true);
      }}
    >
      <h3>New operation</h3>
      <div className="row-wrap">
        {(['deposit', 'withdrawal'] as const).map((t) => (
          <button
            type="button"
            key={t}
            className={`chip${form.type === t ? ' active' : ''}`}
            onClick={() => {
              setForm({ ...form, type: t });
              setConfirming(false);
            }}
          >
            {humanize(t)}
          </button>
        ))}
        <span className="muted">via</span>
        {(['physical_cash', 'manager_transfer'] as const).map((m) => (
          <button
            type="button"
            key={m}
            className={`chip${form.method === m ? ' active' : ''}`}
            onClick={() => {
              setForm({ ...form, method: m });
              setConfirming(false);
            }}
          >
            {m === 'physical_cash' ? 'Cash desk (physical)' : 'Manager transfer'}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <Field label="Currency">
          <select
            className="select"
            value={form.currency}
            onChange={(e) => {
              setForm({ ...form, currency: e.target.value });
              setConfirming(false);
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            className="input"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value.replace(',', '.') });
              setConfirming(false);
            }}
            required
          />
        </Field>
      </div>
      <Field label="Reference" hint="Bank transaction id, receipt number or cash slip number.">
        <input
          className="input"
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
          required
          maxLength={128}
        />
      </Field>
      <Field label="Internal note (optional)">
        <input
          className="input"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </Field>
      {confirming && (
        <div className="alert warning">
          Confirm: <b>{humanize(form.type)}</b> of <b>{formatMoney(form.amount || '0', form.currency)}</b>{' '}
          {form.type === 'deposit' ? 'to' : 'from'} <b>{owner.name}</b> via{' '}
          {form.method === 'physical_cash' ? 'the cash desk' : 'manager transfer'} (ref. {form.reference}).
        </div>
      )}
      <ErrorAlert error={submit.error} />
      <div className="row-wrap">
        <button className={`btn ${confirming ? 'success' : 'primary'}`} disabled={submit.isPending}>
          {confirming ? 'Confirm operation' : 'Review operation'}
        </button>
        {confirming && (
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Edit
          </button>
        )}
      </div>
    </form>
  );
}

export function CashDeskPage() {
  const { can } = useAdmin();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const owners = useQuery({
    queryKey: ['owners', search],
    queryFn: () => api.admin.findOwners(search),
    enabled: !!search,
  });
  const wallets = useQuery({
    queryKey: ['ownerWallets', owner?.type, owner?.id],
    queryFn: () => api.admin.wallets(owner!.type, owner!.id),
    enabled: !!owner,
  });
  const journal = useQuery({
    queryKey: ['cash', offset],
    queryFn: () => api.admin.cashOperations({ limit, offset }),
  });

  return (
    <div className="page stack-lg">
      <PageHeader
        title="Cash desk"
        subtitle="Deposits and withdrawals for personal and business balances in any world currency — by manager transfer or physical cash."
      />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <h3>Account</h3>
          <input
            className="input"
            placeholder="Search a person or a company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="list">
            {owners.data?.map((o) => (
              <button
                key={`${o.type}:${o.id}`}
                className={`list-item${owner?.id === o.id ? ' active' : ''}`}
                onClick={() => setOwner(o)}
              >
                <span className={`badge ${o.type === 'user' ? 'info' : 'council'}`}>
                  {o.type === 'user' ? 'Person' : 'Company'}
                </span>
                <span className="grow">
                  <b>{o.name}</b>{' '}
                  <span className="muted small">{o.type === 'user' ? `@${o.handle}` : o.handle}</span>
                </span>
              </button>
            ))}
          </div>
          {search && owners.data?.length === 0 && <Empty title="Nothing found" />}
          {owner && (
            <div className="stack-sm">
              <h3>Balances of {owner.name}</h3>
              {wallets.isLoading && <Spinner />}
              {wallets.data?.length === 0 && (
                <p className="small muted">No balances yet — a deposit opens one.</p>
              )}
              {wallets.data?.map((w) => (
                <div key={w.id} className="spread small">
                  <b>{w.currency}</b>
                  <span>
                    <Money amount={w.balance} currency={w.currency} />
                    {Number(w.frozen) > 0 && (
                      <span className="muted"> · {formatMoney(w.frozen, w.currency)} frozen</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {owner && can('wallet.cash') ? (
          <OperationForm key={owner.id} owner={owner} />
        ) : (
          <div className="card">
            <Empty title={can('wallet.cash') ? 'Pick an account first' : 'Read-only access'}>
              {can('wallet.cash')
                ? 'Search for the person or company on the left.'
                : 'Only finance managers, admins and the owner can move money.'}
            </Empty>
          </div>
        )}
      </div>

      <div className="card pad-0 table-wrap">
        <div className="card-header" style={{ padding: '16px 18px 0' }}>
          <h3>Journal</h3>
        </div>
        <ErrorAlert error={journal.error} />
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th>Operation</th>
              <th className="right">Amount</th>
              <th>Reference</th>
              <th>Processed by</th>
            </tr>
          </thead>
          <tbody>
            {journal.data?.items.map((op) => (
              <tr key={op.id}>
                <td className="small nowrap">{formatDate(op.createdAt)}</td>
                <td>{op.ownerName}</td>
                <td className="small">
                  {humanize(op.type)} · {op.method === 'physical_cash' ? 'cash desk' : 'manager transfer'}
                </td>
                <td className={`right ${op.type === 'deposit' ? 'pos' : 'neg'}`}>
                  <Money amount={op.amount} currency={op.currency} />
                </td>
                <td className="small">
                  <code>{op.reference}</code>
                  {op.note && <div className="muted">{op.note}</div>}
                </td>
                <td className="small">@{op.processedBy.username}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {journal.data?.items.length === 0 && <Empty title="No operations yet" />}
        {journal.data && (
          <Pager total={journal.data.total} limit={limit} offset={offset} onChange={setOffset} />
        )}
      </div>
    </div>
  );
}
