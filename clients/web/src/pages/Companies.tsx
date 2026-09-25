import { ORG_ROLES, type OrgRole } from '@ovl/shared';
import type { Organization, PaymentApproval } from '@ovl/shared';
import {
  Avatar,
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

const KIND_ICON = { transfer: 'send', invoice: 'receipt', exchange: 'refresh', payroll: 'users' } as const;

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
      {o.myRole && <Members orgId={o.id} canManage={canManage} />}
      {editing && <EditCompanyModal org={o} onClose={() => setEditing(false)} />}
    </div>
  );
}
