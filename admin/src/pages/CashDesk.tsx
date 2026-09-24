import { CURRENCIES, type CashRequest } from '@ovl/shared';
import {
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  formatMoney,
  humanize,
  Icon,
  Modal,
  Money,
  PageHeader,
  Segmented,
  Spinner,
  StatusBadge,
  useDebounced,
  useToast,
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
      invalidateCash(queryClient);
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

const METHOD = { manager_transfer: 'bank transfer', physical_cash: 'cash desk' } as const;

function invalidateCash(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['cashRequests', 'cash', 'ownerWallets', 'stats'])
    queryClient.invalidateQueries({ queryKey: [key] });
}

/** Pay out / confirm a request (records the cash operation), or decline it with a reason. */
function HandleRequestModal({
  request,
  action,
  onClose,
}: {
  request: CashRequest;
  action: 'complete' | 'decline';
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reference, setReference] = useState('');
  const [text, setText] = useState('');
  const complete = action === 'complete';
  const deposit = request.type === 'deposit';
  const submit = useMutation({
    mutationFn: () =>
      complete
        ? api.admin.completeCashRequest(request.id, { reference, note: text || undefined })
        : api.admin.declineCashRequest(request.id, text),
    onSuccess: () => {
      invalidateCash(queryClient);
      toast.success(complete ? (deposit ? 'Deposit recorded' : 'Payout recorded') : 'Request declined');
      onClose();
    },
  });
  const verb = deposit ? 'deposit' : 'payout';
  return (
    <Modal title={complete ? `Confirm ${verb}` : `Decline ${verb}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <div className={`alert ${complete ? 'warning' : 'info'}`}>
          <span>
            <b>{formatMoney(request.amount, request.currency)}</b> {deposit ? 'to' : 'from'}{' '}
            <b>{request.ownerName}</b> via {METHOD[request.method]}, asked by @{request.requestedBy.username}.
            {complete &&
              (deposit
                ? ' Confirm only once the money has arrived.'
                : ' Confirm only once the money has been paid out; the balance is debited now.')}
          </span>
        </div>
        {request.note && (
          <p className="small" style={{ margin: 0 }}>
            <span className="muted">Their note:</span> “{request.note}”
          </p>
        )}
        {complete ? (
          <>
            <Field label="Reference" hint="Bank transaction id, receipt number or cash slip number.">
              <input
                className="input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={128}
                autoFocus
                required
              />
            </Field>
            <Field label="Internal note (optional)">
              <input
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
              />
            </Field>
          </>
        ) : (
          <Field label="Reason" hint="Shown to the person who asked.">
            <textarea
              className="textarea"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={3}
              maxLength={500}
              autoFocus
              required
            />
          </Field>
        )}
        <ErrorAlert error={submit.error} />
        <button className={`btn ${complete ? 'success' : 'danger'}`} disabled={submit.isPending}>
          {complete ? `Confirm ${verb}` : 'Decline request'}
        </button>
      </form>
    </Modal>
  );
}

function RequestQueue() {
  const { can, me } = useAdmin();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [open, setOpen] = useState<{ request: CashRequest; action: 'complete' | 'decline' } | null>(null);
  const requests = useQuery({
    queryKey: ['cashRequests', status],
    queryFn: () => api.admin.cashRequests(status === 'all' ? undefined : 'pending'),
    refetchInterval: 30_000,
  });
  return (
    <div className="card pad-0 table-wrap">
      <div className="card-header" style={{ padding: '16px 18px 0' }}>
        <div>
          <h3>Requests</h3>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            Deposits and payouts people asked for from their wallet. Payouts hold the amount until handled.
          </p>
        </div>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: 'Waiting' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <ErrorAlert error={requests.error} />
      <table className="table">
        <thead>
          <tr>
            <th>Asked</th>
            <th>Account</th>
            <th>Request</th>
            <th className="right">Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {requests.data?.map((r) => {
            const own = r.requestedBy.id === me.id;
            return (
              <tr key={r.id}>
                <td className="small nowrap">{formatDate(r.createdAt)}</td>
                <td>
                  <b>{r.ownerName}</b>
                  <div className="small muted">
                    {r.ownerType === 'organization' ? 'Company' : 'Person'} · by @{r.requestedBy.username}
                  </div>
                </td>
                <td className="small">
                  <span className="row" style={{ gap: 6 }}>
                    <Icon name={r.type === 'deposit' ? 'incoming' : 'outgoing'} size={15} />
                    {r.type === 'deposit' ? 'Deposit' : 'Payout'} · {METHOD[r.method]}
                  </span>
                  {r.note && (
                    <div className="muted ellipsis" style={{ maxWidth: 280 }}>
                      “{r.note}”
                    </div>
                  )}
                  {r.reference && (
                    <div className="muted">
                      ref. <code>{r.reference}</code> · @{r.handledBy?.username}
                    </div>
                  )}
                  {r.declineReason && <div className="muted">{r.declineReason}</div>}
                </td>
                <td className={`right ${r.type === 'deposit' ? 'pos' : 'neg'}`}>
                  <Money amount={r.amount} currency={r.currency} />
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="right nowrap">
                  {r.status === 'pending' && can('wallet.cash') && (
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm success"
                        disabled={own}
                        title={own ? 'Another finance manager must handle your own request' : undefined}
                        onClick={() => setOpen({ request: r, action: 'complete' })}
                      >
                        <Icon name="check" size={14} /> {r.type === 'deposit' ? 'Confirm' : 'Pay out'}
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => setOpen({ request: r, action: 'decline' })}
                      >
                        Decline
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {requests.data?.length === 0 && (
        <Empty title={status === 'pending' ? 'Nothing is waiting' : 'No requests yet'}>
          {status === 'pending' ? 'New deposit and payout requests show up here.' : undefined}
        </Empty>
      )}
      {open && <HandleRequestModal {...open} onClose={() => setOpen(null)} />}
    </div>
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
        icon="wallet"
        title="Cash desk"
        subtitle="Deposits and withdrawals for personal and business balances in any world currency — by manager transfer or physical cash."
      />
      <RequestQueue />
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
