import { ORG_ROLES, type OrgRole } from '@ovl/shared';
import type { Organization } from '@ovl/shared';
import {
  Avatar,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  humanize,
  Icon,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  UserName,
  VerifiedBadge,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import {
  CashRequestModal,
  CashRequests,
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
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <select
            className="select"
            style={{ maxWidth: 160 }}
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
      {cash && selected && <CashRequestModal wallet={selected} type={cash} onClose={() => setCash(null)} />}
    </div>
  );
}

function EditCompanyModal({ org, onClose }: { org: Organization; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ description: org.description, website: org.website ?? '' });
  const save = useMutation({
    mutationFn: () => api.organizations.update(org.id, form),
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
      {finance && <Balances orgId={o.id} />}
      {o.myRole && <Members orgId={o.id} canManage={canManage} />}
      {editing && <EditCompanyModal org={o} onClose={() => setEditing(false)} />}
    </div>
  );
}
