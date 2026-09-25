import { ORG_ROLES, type OrgRole } from '@ovl/shared';
import {
  formatAmount,
  parseAmount,
  type FileInfo,
  type Organization,
  type PaymentApproval,
  type PayrollRun,
} from '@ovl/shared';
import {
  AttachmentPicker,
  Avatar,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  formatMoney,
  humanize,
  plural,
  Icon,
  Modal,
  Money,
  PageHeader,
  Spinner,
  StatusBadge,
  useToast,
  UserName,
  VerifiedBadge,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  CashRequestModal,
  CashRequests,
  ConvertModal,
  OpenWalletForm,
  Statement,
  TransferModal,
  WalletCards,
} from '../components/WalletPanel';

export function CompaniesPage() {
  const orgs = useQuery({ queryKey: ['orgs', 'mine'], queryFn: api.organizations.mine });
  return (
    <div className="page stack-lg">
      <PageHeader
        icon="building"
        title="Companies"
        subtitle="Your business accounts. New companies are registered through an application reviewed by moderation and the council."
        actions={
          <Link className="btn primary" to="/applications?new=company">
            Register a company
          </Link>
        }
      />
      {orgs.isLoading && <Spinner center />}
      <ErrorAlert error={orgs.error} />
      {orgs.data?.length === 0 && (
        <div className="card">
          <Empty title="You are not part of any company yet">
            Submit a company application — once approved, your company, its business license and (optionally)
            its stock listing are created automatically.
          </Empty>
        </div>
      )}
      <div className="grid-2">
        {orgs.data?.map((o) => (
          <Link key={o.id} to={`/companies/${o.slug}`} className="card stack-sm" style={{ color: 'inherit' }}>
            <div className="row">
              <Avatar name={o.name} size={44} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <h3>{o.name}</h3>
                  {o.verified && <VerifiedBadge compact />}
                </div>
                <div className="small muted">{o.registryNumber}</div>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div className="row-wrap small">
              <span className="badge">{humanize(o.myRole ?? 'member')}</span>
              {o.ticker && <span className="badge info">{o.ticker}</span>}
              <span className="muted">{o.memberCount} members</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Members({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['orgMembers', orgId],
    queryFn: () => api.organizations.members(orgId),
  });
  const [form, setForm] = useState<{ username: string; role: Exclude<OrgRole, 'owner'> }>({
    username: '',
    role: 'member',
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orgMembers', orgId] });
  const add = useMutation({
    mutationFn: () => api.organizations.addMember(orgId, form.username, form.role),
    onSuccess: () => {
      setForm({ ...form, username: '' });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.organizations.removeMember(orgId, userId),
    onSuccess: refresh,
  });

  return (
    <div className="card stack">
      <h3>Team</h3>
      <div className="list">
        {members.data?.map((m) => (
          <div key={m.user.id} className="list-item" style={{ cursor: 'default' }}>
            <Avatar name={m.user.displayName} url={m.user.avatarUrl} size={32} />
            <div className="grow">
              <UserName user={m.user} showHandle />
            </div>
            <span className="badge">{humanize(m.role)}</span>
            {canManage && m.role !== 'owner' && (
              <button className="btn sm ghost" onClick={() => remove.mutate(m.user.id)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form
          className="row-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="username"
            aria-label="Username to add"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <select
            className="select"
            style={{ maxWidth: 160 }}
            aria-label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Exclude<OrgRole, 'owner'> })}
          >
            {ORG_ROLES.filter((r) => r !== 'owner').map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
          <button className="btn">Add / change role</button>
        </form>
      )}
      <ErrorAlert error={add.error ?? remove.error} />
      <p className="tiny muted">Owners, directors and accountants can see and move the business balance.</p>
    </div>
  );
}

function Balances({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const wallets = useQuery({
    queryKey: ['orgWallets', orgId],
    queryFn: () => api.organizations.wallets(orgId),
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [cash, setCash] = useState<'deposit' | 'withdrawal' | null>(null);
  const selected = wallets.data?.find((w) => w.id === selectedId) ?? wallets.data?.[0];

  return (
    <div className="stack">
      <div className="spread">
        <h2>Business balance</h2>
        {selected && (
          <div className="row-wrap">
            <button className="btn" onClick={() => setCash('deposit')}>
              <Icon name="incoming" size={16} /> Deposit
            </button>
            <button className="btn" onClick={() => setCash('withdrawal')}>
              <Icon name="outgoing" size={16} /> Withdraw
            </button>
            <button className="btn" onClick={() => setConverting(true)}>
              <Icon name="refresh" size={16} /> Convert
            </button>
            <button className="btn primary" onClick={() => setSending(true)}>
              <Icon name="send" size={16} /> Send money
            </button>
          </div>
        )}
      </div>
      {wallets.data && (
        <WalletCards wallets={wallets.data} selected={selected?.id} onSelect={setSelectedId} />
      )}
      <div className="card stack-sm">
        <h3>Open a balance in another currency</h3>
        <OpenWalletForm
          onOpen={async (currency) => {
            const w = await api.organizations.openWallet(orgId, currency);
            await queryClient.invalidateQueries({ queryKey: ['orgWallets', orgId] });
            setSelectedId(w.id);
          }}
        />
      </div>
      {selected && <CashRequests wallet={selected} />}
      {selected && <Statement wallet={selected} />}
      {sending && selected && <TransferModal wallet={selected} onClose={() => setSending(false)} />}
      {converting && selected && <ConvertModal wallet={selected} onClose={() => setConverting(false)} />}
      {cash && selected && <CashRequestModal wallet={selected} type={cash} onClose={() => setCash(null)} />}
    </div>
  );
}

const KIND_ICON = {
  transfer: 'send',
  invoice: 'receipt',
  exchange: 'refresh',
  payroll: 'users',
  dividend: 'pie',
} as const;

/** Company payments above the approval limit: a second finance member signs or declines them. */
function PaymentApprovals({ org, myId }: { org: Organization; myId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const approvals = useQuery({
    queryKey: ['paymentApprovals', org.id, showAll],
    queryFn: () => api.organizations.paymentApprovals(org.id, showAll ? undefined : 'pending'),
  });
  const [declining, setDeclining] = useState<PaymentApproval | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => {
    for (const key of ['paymentApprovals', 'orgWallets', 'wallet', 'entries', 'invoices'])
      queryClient.invalidateQueries({ queryKey: [key] });
  };
  const approve = useMutation({
    mutationFn: (a: PaymentApproval) => api.organizations.approvePayment(org.id, a.id),
    onSuccess: (a) => {
      refresh();
      toast.success(`Approved: ${a.description}`);
    },
  });
  const decline = useMutation({
    mutationFn: (a: PaymentApproval) => api.organizations.rejectPayment(org.id, a.id, reason),
    onSuccess: (a) => {
      refresh();
      setDeclining(null);
      setReason('');
      toast.success(a.requestedBy.id === myId ? 'Payment withdrawn' : 'Payment declined');
    },
  });
  const pending = (approvals.data ?? []).filter((a) => a.status === 'pending').length;
  if (!org.approvalLimit && !approvals.data?.length) return null;

  return (
    <div className="card stack-sm">
      <div className="card-header">
        <div>
          <h3>Payments waiting for approval</h3>
          <p className="small muted">
            {org.approvalLimit
              ? `Payments of ${formatMoney(org.approvalLimit, org.baseCurrency)} or more need a second owner, director or accountant. The money is set aside meanwhile.`
              : 'The approval limit is off: payments go through at once.'}
          </p>
        </div>
        <button className="btn ghost sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Only waiting' : 'History'}
        </button>
      </div>
      <ErrorAlert error={approve.error ?? approvals.error} />
      {approvals.data?.length === 0 && (
        <p className="small muted">
          {showAll ? 'No payments needed a second signature yet.' : 'Nothing is waiting.'}
        </p>
      )}
      <div className="list">
        {approvals.data?.map((a) => {
          const mine = a.requestedBy.id === myId;
          return (
            <div key={a.id} className="list-item cash-request">
              <span className="cr-icon withdrawal">
                <Icon name={KIND_ICON[a.kind]} size={17} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="bold ellipsis">{a.description}</div>
                <div className="small muted">
                  {mine ? 'You' : a.requestedBy.displayName} · {formatDate(a.createdAt)}
                  {a.decidedBy && ` · ${humanize(a.status)} by ${a.decidedBy.displayName}`}
                  {!a.decidedBy && a.status !== 'pending' && ` · ${humanize(a.status)}`}
                </div>
                {a.reason && <div className="small ellipsis">“{a.reason}”</div>}
              </div>
              <div className="cr-amount">
                <b>
                  −<Money amount={a.amount} currency={a.currency} />
                </b>
                <StatusBadge status={a.status} />
              </div>
              {a.status === 'pending' && (
                <div className="row" style={{ gap: 6 }}>
                  {!mine && (
                    <button
                      className="btn primary sm"
                      onClick={() => approve.mutate(a)}
                      disabled={approve.isPending}
                    >
                      Approve
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => setDeclining(a)}>
                    {mine ? 'Withdraw' : 'Decline'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pending > 0 && !approvals.data?.some((a) => a.status === 'pending' && a.requestedBy.id !== myId) && (
        <p className="tiny muted">Another finance member approves the payments you started.</p>
      )}
      {declining && (
        <Modal
          title={declining.requestedBy.id === myId ? 'Withdraw payment' : 'Decline payment'}
          onClose={() => setDeclining(null)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              decline.mutate(declining);
            }}
          >
            <p>{declining.description}</p>
            <Field label="Reason">
              <input
                className="input"
                value={reason}
                minLength={3}
                maxLength={500}
                required
                autoFocus
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <ErrorAlert error={decline.error} />
            <button className="btn danger" disabled={decline.isPending}>
              {declining.requestedBy.id === myId ? 'Withdraw' : 'Decline'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

interface PayLine {
  username: string;
  amount: string;
  note: string;
}
const emptyLine = (): PayLine => ({ username: '', amount: '', note: '' });

/** Pay the team from a company balance in one go. */
function Payroll({ org }: { org: Organization }) {
  const runs = useQuery({ queryKey: ['payroll', org.id], queryFn: () => api.organizations.payroll(org.id) });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card stack-sm">
      <div className="card-header">
        <div>
          <h3>Payroll</h3>
          <p className="small muted">Pay salaries and fees to many people at once from a business balance.</p>
        </div>
        <button className="btn sm" onClick={() => setCreating(true)}>
          <Icon name="users" size={15} /> New payroll run
        </button>
      </div>
      <ErrorAlert error={runs.error} />
      {runs.data?.length === 0 && <p className="small muted">No payroll runs yet.</p>}
      <div className="list">
        {runs.data?.map((r) => (
          <div key={r.id} className="stack-sm">
            <button
              className="list-item"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setOpen(open === r.id ? null : r.id)}
              aria-expanded={open === r.id}
            >
              <span className="cr-icon deposit">
                <Icon name="users" size={17} />
              </span>
              <div className="grow">
                <b>{r.title}</b>
                <div className="small muted">
                  {plural(r.items.length, 'person', 'people')} · {formatDate(r.createdAt)} · by{' '}
                  {r.createdBy.displayName}
                </div>
              </div>
              <div className="cr-amount">
                <b>
                  −<Money amount={r.total} currency={r.currency} />
                </b>
                <StatusBadge status={r.status === 'pending' ? 'waiting_for_approval' : r.status} />
              </div>
            </button>
            {open === r.id && (
              <table className="table" style={{ marginLeft: 12 }}>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.user.id}>
                      <td>
                        <b>{i.user.displayName}</b> <span className="small muted">@{i.user.username}</span>
                        {i.note && <div className="small muted">{i.note}</div>}
                      </td>
                      <td className="right">
                        <Money amount={i.amount} currency={r.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      {creating && <PayrollModal org={org} last={runs.data?.[0]} onClose={() => setCreating(false)} />}
    </div>
  );
}

function PayrollModal({ org, last, onClose }: { org: Organization; last?: PayrollRun; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const wallets = useQuery({
    queryKey: ['orgWallets', org.id],
    queryFn: () => api.organizations.wallets(org.id),
  });
  const [walletId, setWalletId] = useState<string>();
  const wallet = wallets.data?.find((w) => w.id === walletId) ?? wallets.data?.[0];
  const [title, setTitle] = useState(
    `Salaries — ${new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })}`,
  );
  const [lines, setLines] = useState<PayLine[]>([emptyLine()]);
  const setLine = (n: number, patch: Partial<PayLine>) =>
    setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const currency = wallet?.currency ?? org.baseCurrency;
  let total = '—';
  try {
    total = formatMoney(
      formatAmount(
        lines.reduce((sum, l) => sum + parseAmount(l.amount || '0', currency), 0n),
        currency,
      ),
      currency,
    );
  } catch {
    // an amount that is not a number yet
  }
  const run = useMutation({
    mutationFn: () =>
      api.organizations.runPayroll(org.id, {
        walletId: wallet!.id,
        title,
        items: lines.map((l) => ({
          username: l.username.trim().replace(/^@/, '').toLowerCase(),
          amount: l.amount,
          note: l.note || undefined,
        })),
      }),
    onSuccess: (r) => {
      for (const key of ['payroll', 'orgWallets', 'wallet', 'entries', 'paymentApprovals'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(
        r.status === 'pending'
          ? 'Above the approval limit: another finance member has to approve this payroll'
          : `Paid ${formatMoney(r.total, r.currency)} to ${plural(r.items.length, 'person', 'people')}`,
      );
      onClose();
    },
  });
  return (
    <Modal title="New payroll run" onClose={onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <div className="grid-2">
          <Field label="Title">
            <input
              className="input"
              value={title}
              maxLength={120}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Pay from">
            <select className="select" value={wallet?.id} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.currency} · available {formatMoney(w.available, w.currency)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="stack-sm">
          {lines.map((l, n) => (
            <div key={n} className="invoice-line">
              <input
                className="input"
                placeholder="username"
                aria-label={`Person ${n + 1}`}
                value={l.username}
                onChange={(e) => setLine(n, { username: e.target.value })}
                required
              />
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Person ${n + 1} amount`}
                value={l.amount}
                onChange={(e) => setLine(n, { amount: e.target.value.replace(',', '.') })}
                required
              />
              <input
                className="input"
                placeholder="Note (optional)"
                aria-label={`Person ${n + 1} note`}
                value={l.note}
                maxLength={200}
                onChange={(e) => setLine(n, { note: e.target.value })}
              />
              <button
                type="button"
                className="btn ghost icon sm"
                aria-label={`Remove person ${n + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, i) => i !== n))}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
          <div className="spread">
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn sm"
                disabled={lines.length >= 200}
                onClick={() => setLines([...lines, emptyLine()])}
              >
                <Icon name="plus" size={14} /> Add person
              </button>
              {last && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    setLines(
                      last.items.map((i) => ({ username: i.user.username, amount: i.amount, note: i.note })),
                    )
                  }
                >
                  Same as “{last.title}”
                </button>
              )}
            </div>
            <span>
              Total <b className="invoice-total">{total}</b>
            </span>
          </div>
        </div>
        <ErrorAlert error={run.error} />
        <button className="btn primary" disabled={run.isPending || !wallet}>
          <Icon name="send" size={16} /> Pay {plural(lines.length, 'person', 'people')}
        </button>
      </form>
    </Modal>
  );
}

/** Shareholders of a listed company: the registry, dividends, votes and reports. */
function Shareholders({ org }: { org: Organization }) {
  const holders = useQuery({
    queryKey: ['shareholders', org.id],
    queryFn: () => api.organizations.shareholders(org.id),
  });
  const [modal, setModal] = useState<'dividend' | 'vote' | 'report' | null>(null);
  const canManage = org.myRole === 'owner' || org.myRole === 'director';
  const total = (holders.data ?? []).reduce((n, h) => n + Number(h.shares), 0);
  return (
    <div className="card stack-sm">
      <div className="card-header">
        <div>
          <h3>Shareholders</h3>
          <p className="small muted">
            {holders.data?.length ?? 0}{' '}
            {holders.data?.length === 1 ? 'shareholder holds' : 'shareholders hold'} {total.toLocaleString()}{' '}
            {org.ticker} shares. <Link to={`/exchange/${org.ticker}`}>Listing page</Link>
          </p>
        </div>
        {canManage && (
          <div className="row-wrap">
            <button className="btn sm" onClick={() => setModal('report')}>
              <Icon name="file" size={15} /> Publish results
            </button>
            <button className="btn sm" onClick={() => setModal('vote')}>
              <Icon name="check" size={15} /> Ask shareholders
            </button>
            <button className="btn sm primary" onClick={() => setModal('dividend')}>
              <Icon name="pie" size={15} /> Pay a dividend
            </button>
          </div>
        )}
      </div>
      <ErrorAlert error={holders.error} />
      {!!holders.data?.length && (
        <table className="table">
          <thead>
            <tr>
              <th>Shareholder</th>
              <th className="right">Shares</th>
              <th className="right">Share of all</th>
            </tr>
          </thead>
          <tbody>
            {holders.data.slice(0, 20).map((h) => (
              <tr key={h.user.id}>
                <td>
                  <Link to={`/u/${h.user.username}`}>{h.user.displayName}</Link>{' '}
                  <span className="small muted">@{h.user.username}</span>
                </td>
                <td className="right num">{Number(h.shares).toLocaleString()}</td>
                <td className="right">{h.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal === 'dividend' && <DividendModal org={org} shares={total} onClose={() => setModal(null)} />}
      {modal === 'vote' && <ProposalModal org={org} onClose={() => setModal(null)} />}
      {modal === 'report' && <ReportModal org={org} onClose={() => setModal(null)} />}
    </div>
  );
}

function DividendModal({ org, shares, onClose }: { org: Organization; shares: number; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const wallets = useQuery({
    queryKey: ['orgWallets', org.id],
    queryFn: () => api.organizations.wallets(org.id),
  });
  const listing = useQuery({
    queryKey: ['listings', org.ticker],
    queryFn: () => api.stock.listing(org.ticker!),
  });
  const currency = listing.data?.currency ?? org.baseCurrency;
  const wallet = wallets.data?.find((w) => w.currency === currency);
  const [perShare, setPerShare] = useState('');
  const [note, setNote] = useState('');
  const pay = useMutation({
    mutationFn: () =>
      api.organizations.payDividend(org.id, { walletId: wallet!.id, perShare, note: note || undefined }),
    onSuccess: (d) => {
      for (const key of ['orgWallets', 'wallet', 'entries', 'stock', 'paymentApprovals'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(
        d.status === 'pending'
          ? 'Above the approval limit: another finance member has to approve this dividend'
          : `Paid ${formatMoney(d.total, d.currency)} to ${d.holders} shareholders`,
      );
      onClose();
    },
  });
  let total = '—';
  try {
    if (perShare)
      total = formatMoney(formatAmount(parseAmount(perShare, currency) * BigInt(shares), currency), currency);
  } catch {
    total = '—';
  }
  return (
    <Modal title={`Pay a dividend to ${org.ticker} shareholders`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          pay.mutate();
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          Everyone holding shares right now gets the same amount per share on their personal {currency}{' '}
          balance.
        </p>
        {wallet && (
          <div className="alert info small">Available: {formatMoney(wallet.available, currency)}</div>
        )}
        <Field label={`Per share (${currency})`}>
          <input
            className="input"
            inputMode="decimal"
            value={perShare}
            required
            onChange={(e) => setPerShare(e.target.value.replace(',', '.'))}
          />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="spread">
          <span className="muted">
            {shares.toLocaleString()} shares × {perShare || '0'}
          </span>
          <b className="invoice-total">{total}</b>
        </div>
        <ErrorAlert error={pay.error} />
        <button className="btn primary" disabled={pay.isPending || !wallet || !perShare}>
          Pay dividend
        </button>
      </form>
    </Modal>
  );
}

function ProposalModal({ org, onClose }: { org: Organization; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', description: '', days: '7', options: '' });
  const create = useMutation({
    mutationFn: () =>
      api.organizations.createProposal(org.id, {
        title: form.title,
        description: form.description,
        closesAt: new Date(Date.now() + Number(form.days) * 86_400_000).toISOString(),
        options: form.options.trim()
          ? form.options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Shareholders can vote now');
      onClose();
    },
  });
  return (
    <Modal title="Ask the shareholders" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          Each shareholder votes once, weighted by the shares they hold now.
        </p>
        <Field label="Question">
          <input
            className="input"
            value={form.title}
            minLength={3}
            maxLength={200}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Details">
          <textarea
            className="textarea"
            value={form.description}
            minLength={10}
            required
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid-2">
          <Field label="Voting runs for">
            <select
              className="select"
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? 'day' : 'days'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Options (optional)" hint="Comma-separated; For, Against, Abstain by default">
            <input
              className="input"
              value={form.options}
              onChange={(e) => setForm({ ...form, options: e.target.value })}
            />
          </Field>
        </div>
        <ErrorAlert error={create.error} />
        <button className="btn primary" disabled={create.isPending}>
          Open the vote
        </button>
      </form>
    </Modal>
  );
}

function ReportModal({ org, onClose }: { org: Organization; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = new Date();
  const [form, setForm] = useState({
    period: `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`,
    title: '',
    body: '',
    revenue: '',
    profit: '',
  });
  const [files, setFiles] = useState<FileInfo[]>([]);
  const publish = useMutation({
    mutationFn: () =>
      api.organizations.publishReport(org.id, {
        period: form.period,
        title: form.title,
        body: form.body,
        revenue: form.revenue || undefined,
        profit: form.profit || undefined,
        attachments: files.map((f) => f.id),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Results published on the listing page');
      onClose();
    },
  });
  return (
    <Modal title="Publish results" onClose={onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <div className="grid-2">
          <Field label="Period" hint="2026-Q3, 2026-H1 or 2026">
            <input
              className="input"
              value={form.period}
              required
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            />
          </Field>
          <Field label="Title">
            <input
              className="input"
              value={form.title}
              minLength={3}
              maxLength={200}
              required
              placeholder="Third quarter results"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Revenue (optional)">
            <input
              className="input"
              inputMode="decimal"
              value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value.replace(',', '.') })}
            />
          </Field>
          <Field label="Profit (optional)" hint="Negative for a loss">
            <input
              className="input"
              inputMode="decimal"
              value={form.profit}
              onChange={(e) => setForm({ ...form, profit: e.target.value.replace(',', '.') })}
            />
          </Field>
        </div>
        <Field label="What happened">
          <textarea
            className="textarea"
            style={{ minHeight: 140 }}
            value={form.body}
            minLength={10}
            required
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </Field>
        <Field label="Documents (optional)">
          <AttachmentPicker
            value={files}
            onChange={setFiles}
            upload={(file) => api.files.upload(file, file.name)}
            remove={(file) => api.files.remove(file.id)}
            href={api.files.url}
            max={10}
          />
        </Field>
        <ErrorAlert error={publish.error} />
        <button className="btn primary" disabled={publish.isPending}>
          Publish
        </button>
      </form>
    </Modal>
  );
}

function EditCompanyModal({ org, onClose }: { org: Organization; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    description: org.description,
    website: org.website ?? '',
    approvalLimit: org.approvalLimit ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.organizations.update(org.id, {
        description: form.description,
        website: form.website,
        ...(form.approvalLimit !== (org.approvalLimit ?? '') ? { approvalLimit: form.approvalLimit } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      onClose();
    },
  });
  return (
    <Modal title={`Edit ${org.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Description" hint="Shown on the public company profile and the stock exchange.">
          <textarea
            className="textarea"
            style={{ minHeight: 140 }}
            value={form.description}
            minLength={10}
            maxLength={5000}
            required
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Website">
          <input
            className="input"
            type="url"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </Field>
        <Field
          label={`Approval limit (${org.baseCurrency})`}
          hint="Payments, exchanges and invoice payments of at least this much need a second owner, director or accountant. Leave empty to turn it off."
        >
          <input
            className="input"
            inputMode="decimal"
            placeholder="Off"
            value={form.approvalLimit}
            onChange={(e) => setForm({ ...form, approvalLimit: e.target.value.replace(',', '.') })}
          />
        </Field>
        <ErrorAlert error={save.error} />
        <button className="btn primary" disabled={save.isPending}>
          Save
        </button>
      </form>
    </Modal>
  );
}

export function CompanyPage() {
  const { slug = '' } = useParams();
  const org = useQuery({ queryKey: ['orgs', slug], queryFn: () => api.organizations.get(slug) });
  const { me } = useAuth();
  const [editing, setEditing] = useState(false);
  if (org.isLoading) return <Spinner center />;
  if (!org.data)
    return (
      <div className="page">
        <ErrorAlert error={org.error} />
      </div>
    );
  const o = org.data;
  const finance = o.myRole && ['owner', 'director', 'accountant'].includes(o.myRole);
  const canManage = o.myRole === 'owner' || o.myRole === 'director';

  return (
    <div className="page stack-lg">
      <div className="card stack">
        <div className="row">
          <Avatar name={o.name} size={64} />
          <div className="grow stack-sm">
            <div className="row-wrap">
              <h1>{o.name}</h1>
              <StatusBadge status={o.status} />
              {o.verified && <VerifiedBadge />}
              {o.ticker && (
                <Link to={`/exchange/${o.ticker}`} className="badge info">
                  {o.ticker} on the exchange
                </Link>
              )}
            </div>
            <div className="muted small">
              Registry number <code>{o.registryNumber ?? '—'}</code> · registered{' '}
              {formatDate(o.createdAt, false)}
              {o.registryNumber && (
                <>
                  {' · '}
                  <a href={api.registry.certificateUrl(o.registryNumber)} target="_blank" rel="noreferrer">
                    Registration certificate
                  </a>
                </>
              )}
            </div>
          </div>
          {canManage && (
            <button className="btn sm" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{o.description}</p>
        <dl className="dl">
          <dt>Owner</dt>
          <dd>
            <Link to={`/u/${o.owner.username}`}>{o.owner.displayName}</Link>
          </dd>
          <dt>Base currency</dt>
          <dd>{o.baseCurrency}</dd>
          {o.country && (
            <>
              <dt>Country</dt>
              <dd>{o.country}</dd>
            </>
          )}
          {o.website && (
            <>
              <dt>Website</dt>
              <dd>
                <a href={o.website} target="_blank" rel="noreferrer">
                  {o.website}
                </a>
              </dd>
            </>
          )}
        </dl>
      </div>
      {finance && me && <PaymentApprovals org={o} myId={me.id} />}
      {finance && <Balances orgId={o.id} />}
      {finance && <Payroll org={o} />}
      {o.ticker && o.myRole && <Shareholders org={o} />}
      {o.myRole && <Members orgId={o.id} canManage={canManage} />}
      {editing && <EditCompanyModal org={o} onClose={() => setEditing(false)} />}
    </div>
  );
}
