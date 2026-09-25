import { CURRENCIES, type CashApproval, type CashRequest } from '@ovl/shared';
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
  t,
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
  const toast = useToast();
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
    onSuccess: (result) => {
      setConfirming(false);
      setForm({ ...form, amount: '', reference: '', note: '' });
      invalidateCash(queryClient);
      if ('kind' in result)
        toast.info(t('Large amount: it waits for a second finance manager under “Waiting for approval”'));
      else toast.success(t('Operation recorded'));
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
      <h3>{t('New operation')}</h3>
      <div className="row-wrap">
        {(['deposit', 'withdrawal'] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            className={`chip${form.type === kind ? ' active' : ''}`}
            onClick={() => {
              setForm({ ...form, type: kind });
              setConfirming(false);
            }}
          >
            {humanize(kind)}
          </button>
        ))}
        <span className="muted">{t('via')}</span>
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
            {m === 'physical_cash' ? t('Cash desk (physical)') : t('Manager transfer')}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <Field label={t('Currency')}>
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
        <Field label={t('Amount')}>
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
      <Field label={t('Reference')} hint={t('Bank transaction id, receipt number or cash slip number.')}>
        <input
          className="input"
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
          required
          maxLength={128}
        />
      </Field>
      <Field label={t('Internal note (optional)')}>
        <input
          className="input"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </Field>
      {confirming && (
        <div className="alert warning">
          {t('Confirm:')} <b>{humanize(form.type)}</b> {t('of')}{' '}
          <b>{formatMoney(form.amount || '0', form.currency)}</b>{' '}
          {form.type === 'deposit' ? t('to') : t('from')} <b>{owner.name}</b>{' '}
          {t(
            'via {0} (ref. {1}).',
            form.method === 'physical_cash' ? 'the cash desk' : 'manager transfer',
            form.reference,
          )}
        </div>
      )}
      <ErrorAlert error={submit.error} />
      <div className="row-wrap">
        <button className={`btn ${confirming ? 'success' : 'primary'}`} disabled={submit.isPending}>
          {confirming ? t('Confirm operation') : t('Review operation')}
        </button>
        {confirming && (
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            {t('Edit')}
          </button>
        )}
      </div>
    </form>
  );
}

const METHOD = { manager_transfer: 'bank transfer', physical_cash: 'cash desk' } as const;

function invalidateCash(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['cashRequests', 'cashApprovals', 'cash', 'ownerWallets', 'stats'])
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
      toast.success(
        complete ? (deposit ? t('Deposit recorded') : t('Payout recorded')) : t('Request declined'),
      );
      onClose();
    },
  });
  return (
    <Modal
      title={
        complete
          ? deposit
            ? t('Confirm deposit')
            : t('Confirm payout')
          : deposit
            ? t('Decline deposit')
            : t('Decline payout')
      }
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <div className={`alert ${complete ? 'warning' : 'info'}`}>
          <span>
            <b>{formatMoney(request.amount, request.currency)}</b> {deposit ? t('to') : t('from')}{' '}
            <b>{request.ownerName}</b> {t('via')} {METHOD[request.method]}
            {t(', asked by @')}
            {request.requestedBy.username}.
            {complete &&
              (deposit
                ? ` ${t('Confirm only once the money has arrived.')}`
                : ` ${t('Confirm only once the money has been paid out; the balance is debited now.')}`)}
          </span>
        </div>
        {request.note && (
          <p className="small" style={{ margin: 0 }}>
            <span className="muted">{t('Their note:')}</span> “{request.note}”
          </p>
        )}
        {complete ? (
          <>
            <Field
              label={t('Reference')}
              hint={t('Bank transaction id, receipt number or cash slip number.')}
            >
              <input
                className="input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={128}
                autoFocus
                required
              />
            </Field>
            <Field label={t('Internal note (optional)')}>
              <input
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
              />
            </Field>
          </>
        ) : (
          <Field label={t('Reason')} hint={t('Shown to the person who asked.')}>
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
          {complete ? (deposit ? t('Confirm deposit') : t('Confirm payout')) : t('Decline request')}
        </button>
      </form>
    </Modal>
  );
}

/** Four eyes: large operations wait here until a second finance manager confirms them. */
function ApprovalQueue() {
  const { can, me } = useAdmin();
  const toast = useToast();
  const queryClient = useQueryClient();
  const approvals = useQuery({
    queryKey: ['cashApprovals'],
    queryFn: () => api.admin.cashApprovals('pending'),
    refetchInterval: 30_000,
  });
  const [rejecting, setRejecting] = useState<CashApproval | null>(null);
  const [reason, setReason] = useState('');
  const approve = useMutation({
    mutationFn: (id: string) => api.admin.approveCash(id),
    onSuccess: (a) => {
      invalidateCash(queryClient);
      toast.success(
        t('{0} of {1} done', a.type === 'deposit' ? 'Deposit' : 'Payout', formatMoney(a.amount, a.currency)),
      );
    },
  });
  const reject = useMutation({
    mutationFn: () => api.admin.rejectCash(rejecting!.id, reason),
    onSuccess: () => {
      invalidateCash(queryClient);
      setRejecting(null);
      setReason('');
    },
  });
  if (!approvals.data?.length) return null;
  return (
    <div className="card pad-0 table-wrap four-eyes">
      <div className="card-header" style={{ padding: '16px 18px 0' }}>
        <div>
          <h3>{t('Waiting for approval')}</h3>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {t(
              'Large operations need a second finance manager. They happen when confirmed; payouts hold the money meanwhile.',
            )}
          </p>
        </div>
      </div>
      <ErrorAlert error={approve.error} />
      <table className="table">
        <thead>
          <tr>
            <th>{t('Asked')}</th>
            <th>{t('Account')}</th>
            <th>{t('Operation')}</th>
            <th className="right">{t('Amount')}</th>
            <th>{t('By')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {approvals.data.map((a) => {
            const own = a.requestedBy.id === me.id;
            return (
              <tr key={a.id}>
                <td className="small nowrap">{formatDate(a.createdAt)}</td>
                <td>
                  <b>{a.ownerName}</b>
                  <div className="small muted">
                    {a.kind === 'request' ? t('Completing a request') : t('Cash desk')}
                  </div>
                </td>
                <td className="small">
                  {t('{0} · {1} · ref.', a.type === 'deposit' ? 'Deposit' : 'Payout', METHOD[a.method])}{' '}
                  <code>{a.reference}</code>
                </td>
                <td className={`right ${a.type === 'deposit' ? 'pos' : 'neg'}`}>
                  <Money amount={a.amount} currency={a.currency} />
                </td>
                <td className="small">@{a.requestedBy.username}</td>
                <td className="right nowrap">
                  {can('wallet.cash') && (
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm success"
                        disabled={own || approve.isPending}
                        title={own ? t('A different finance manager must confirm this') : undefined}
                        onClick={() => approve.mutate(a.id)}
                      >
                        <Icon name="check" size={14} /> {t('Confirm')}
                      </button>
                      <button className="btn sm ghost" onClick={() => setRejecting(a)}>
                        {t('Reject')}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rejecting && (
        <Modal title={t('Reject operation')} onClose={() => setRejecting(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              reject.mutate();
            }}
          >
            <Field label={t('Reason')} hint={t('Recorded in the audit log.')}>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={500}
                autoFocus
                required
              />
            </Field>
            <ErrorAlert error={reject.error} />
            <button className="btn danger" disabled={reject.isPending}>
              {t('Reject')}
            </button>
          </form>
        </Modal>
      )}
    </div>
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
          <h3>{t('Requests')}</h3>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {t(
              'Deposits and payouts people asked for from their wallet. Payouts hold the amount until handled.',
            )}
          </p>
        </div>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: t('Waiting') },
            { value: 'all', label: t('All') },
          ]}
        />
      </div>
      <ErrorAlert error={requests.error} />
      <table className="table">
        <thead>
          <tr>
            <th>{t('Asked')}</th>
            <th>{t('Account')}</th>
            <th>{t('Request')}</th>
            <th className="right">{t('Amount')}</th>
            <th>{t('Status')}</th>
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
                    {t(
                      '{0} · by @{1}',
                      r.ownerType === 'organization' ? 'Company' : 'Person',
                      r.requestedBy.username,
                    )}
                  </div>
                </td>
                <td className="small">
                  <span className="row" style={{ gap: 6 }}>
                    <Icon name={r.type === 'deposit' ? 'incoming' : 'outgoing'} size={15} />
                    {r.type === 'deposit' ? t('Deposit') : t('Payout')} · {METHOD[r.method]}
                  </span>
                  {r.note && (
                    <div className="muted ellipsis" style={{ maxWidth: 280 }}>
                      “{r.note}”
                    </div>
                  )}
                  {r.reference && (
                    <div className="muted">
                      {t('ref.')} <code>{r.reference}</code> · @{r.handledBy?.username}
                    </div>
                  )}
                  {r.declineReason && <div className="muted">{r.declineReason}</div>}
                </td>
                <td className={`right ${r.type === 'deposit' ? 'pos' : 'neg'}`}>
                  <Money amount={r.amount} currency={r.currency} />
                </td>
                <td>
                  <StatusBadge status={r.awaitingApproval ? 'awaiting_approval' : r.status} />
                </td>
                <td className="right nowrap">
                  {r.status === 'pending' && !r.awaitingApproval && can('wallet.cash') && (
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm success"
                        disabled={own}
                        title={own ? t('Another finance manager must handle your own request') : undefined}
                        onClick={() => setOpen({ request: r, action: 'complete' })}
                      >
                        <Icon name="check" size={14} /> {r.type === 'deposit' ? t('Confirm') : t('Pay out')}
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => setOpen({ request: r, action: 'decline' })}
                      >
                        {t('Decline')}
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
        <Empty title={status === 'pending' ? t('Nothing is waiting') : t('No requests yet')}>
          {status === 'pending' ? t('New deposit and payout requests show up here.') : undefined}
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
        title={t('Cash desk')}
        subtitle={t(
          'Deposits and withdrawals for personal and business balances in any world currency — by manager transfer or physical cash.',
        )}
      />
      <ApprovalQueue />
      <RequestQueue />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <h3>{t('Account')}</h3>
          <input
            className="input"
            placeholder={t('Search a person or a company')}
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
                  {o.type === 'user' ? t('Person') : t('Company')}
                </span>
                <span className="grow">
                  <b>{o.name}</b>{' '}
                  <span className="muted small">{o.type === 'user' ? `@${o.handle}` : o.handle}</span>
                </span>
              </button>
            ))}
          </div>
          {search && owners.data?.length === 0 && <Empty title={t('Nothing found')} />}
          {owner && (
            <div className="stack-sm">
              <h3>{t('Balances of {0}', owner.name)}</h3>
              {wallets.isLoading && <Spinner />}
              {wallets.data?.length === 0 && (
                <p className="small muted">{t('No balances yet — a deposit opens one.')}</p>
              )}
              {wallets.data?.map((w) => (
                <div key={w.id} className="spread small">
                  <b>{w.currency}</b>
                  <span>
                    <Money amount={w.balance} currency={w.currency} />
                    {Number(w.frozen) > 0 && (
                      <span className="muted">{t('· {0} frozen', formatMoney(w.frozen, w.currency))}</span>
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
            <Empty title={can('wallet.cash') ? t('Pick an account first') : t('Read-only access')}>
              {can('wallet.cash')
                ? t('Search for the person or company on the left.')
                : t('Only finance managers, admins and the owner can move money.')}
            </Empty>
          </div>
        )}
      </div>

      <div className="card pad-0 table-wrap">
        <div className="card-header" style={{ padding: '16px 18px 0' }}>
          <h3>{t('Journal')}</h3>
        </div>
        <ErrorAlert error={journal.error} />
        <table className="table">
          <thead>
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Account')}</th>
              <th>{t('Operation')}</th>
              <th className="right">{t('Amount')}</th>
              <th>{t('Reference')}</th>
              <th>{t('Processed by')}</th>
            </tr>
          </thead>
          <tbody>
            {journal.data?.items.map((op) => (
              <tr key={op.id}>
                <td className="small nowrap">{formatDate(op.createdAt)}</td>
                <td>{op.ownerName}</td>
                <td className="small">
                  {humanize(op.type)} ·{' '}
                  {op.method === 'physical_cash' ? t('cash desk') : t('manager transfer')}
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
        {journal.data?.items.length === 0 && <Empty title={t('No operations yet')} />}
        {journal.data && (
          <Pager total={journal.data.total} limit={limit} offset={offset} onChange={setOffset} />
        )}
      </div>
    </div>
  );
}
