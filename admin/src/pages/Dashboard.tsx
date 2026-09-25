import type { AuditLog, Role } from '@ovl/shared';
import { ROLE_LABELS, ROLES } from '@ovl/shared';
import {
  AnimatedNumber,
  AreaChart,
  ErrorAlert,
  formatMoney,
  humanize,
  Icon,
  PageHeader,
  plural,
  Segmented,
  Skeleton,
  Stagger,
  StaggerItem,
  timeAgo,
  type IconName,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth';

type Series = 'messages' | 'signups' | 'applications';

const SERIES: { value: Series; label: string }[] = [
  { value: 'messages', label: 'Messages' },
  { value: 'signups', label: 'Sign-ups' },
  { value: 'applications', label: 'Applications' },
];

const ROLE_COLORS: Record<Role, string> = {
  owner: 'var(--owner)',
  admin: 'var(--admin)',
  council: 'var(--council)',
  moderator: 'var(--moderator)',
  manager: 'var(--manager)',
  user: 'var(--text-3)',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Kpi({
  to,
  icon,
  label,
  value,
  tone,
  hint,
}: {
  to?: string;
  icon: IconName;
  label: string;
  value: number;
  tone: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="spread">
        <span className="kpi-label">{label}</span>
        <span
          className="admin-kpi-icon"
          style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}
        >
          <Icon name={icon} size={18} />
        </span>
      </div>
      <span className="kpi-value">
        <AnimatedNumber value={String(value)} format={(v) => Number(v).toLocaleString()} />
      </span>
      {hint && <span className="tiny muted">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="card kpi admin-kpi">
      {body}
    </Link>
  ) : (
    <div className="card kpi admin-kpi">{body}</div>
  );
}

const AUDIT_ICONS: [prefix: string, icon: IconName][] = [
  ['wallet.', 'wallet'],
  ['application.', 'review'],
  ['registry.', 'book'],
  ['organization.', 'building'],
  ['stock.', 'chart'],
  ['story.', 'sparkles'],
  ['apikey.', 'key'],
  ['channel.', 'channel'],
  ['user.', 'user'],
];

const AUDIT_TEXT: Record<string, string> = {
  'wallet.deposit': 'recorded a deposit',
  'wallet.withdrawal': 'recorded a withdrawal',
  'cash_request.decline': 'declined a deposit or payout request',
  'identity.approve': 'verified the identity of',
  'identity.reject': 'rejected the identity check of',
  'identity.revoke': 'revoked the verified status of',
  'application.submit': 'submitted an application',
  'application.approve': 'approved an application',
  'application.reject': 'rejected an application',
  'registry.status': 'changed a registry status',
  'organization.status': 'changed an organization status',
  'organization.member_set': 'changed company members',
  'stock.listing_update': 'updated a stock listing',
  'story.publish': 'published a service story',
  'story.delete': 'deleted a service story',
  'apikey.revoke': 'revoked an API key',
  'channel.create': 'created a news channel',
  'user.update': 'updated an account',
  'user.sign_out': 'signed an account out everywhere',
};

function AuditRow({ log }: { log: AuditLog }) {
  const icon = AUDIT_ICONS.find(([p]) => log.action.startsWith(p))?.[1] ?? 'activity';
  const amount =
    typeof log.data.amount === 'string' && typeof log.data.currency === 'string'
      ? ` · ${formatMoney(log.data.amount, log.data.currency)}`
      : '';
  return (
    <div className="admin-feed-row">
      <span className="admin-feed-icon">
        <Icon name={icon} size={16} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis">
          <b>{log.actor ? `@${log.actor.username}` : 'System'}</b>{' '}
          {AUDIT_TEXT[log.action] ?? humanize(log.action.replace('.', ' ')).toLowerCase()}
          {amount}
        </div>
        <div className="tiny muted">
          {log.targetType ?? 'platform'} · {timeAgo(log.createdAt)}
        </div>
      </div>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

/** How the running platform is doing: instances, connections, queues, jobs and backups. */
function SystemCard() {
  const system = useQuery({ queryKey: ['system'], queryFn: api.admin.system, refetchInterval: 30_000 });
  const s = system.data;
  const failing = s?.jobs.filter((j) => j.lastError) ?? [];
  const backupAge = s?.lastBackup ? (Date.now() - new Date(s.lastBackup.at).getTime()) / 3_600_000 : null;
  return (
    <div className="card stack" aria-label="System">
      <h3>System</h3>
      <ErrorAlert error={system.error} />
      {s && (
        <dl className="dl small">
          <dt>Version</dt>
          <dd>
            {s.instance.version} · up {Math.floor(s.instance.uptimeSeconds / 3600)} h
          </dd>
          <dt>Instances</dt>
          <dd>{s.instances}</dd>
          <dt>Connected now</dt>
          <dd>{plural(s.onlineUsers, 'person', 'people')}</dd>
          <dt>Waiting to send</dt>
          <dd>
            {plural(s.queues.notifications, 'notification')} ·{' '}
            {plural(s.queues.webhooks, 'webhook delivery', 'webhook deliveries')}
          </dd>
          <dt>Last backup</dt>
          <dd className={backupAge === null || backupAge > 26 ? 'neg' : undefined}>
            {s.lastBackup
              ? `${ago(s.lastBackup.at)} · ${(s.lastBackup.bytes / 1_048_576).toFixed(1)} MB`
              : 'none recorded — is the backup service running?'}
          </dd>
          <dt>Background jobs</dt>
          <dd className={failing.length ? 'neg' : undefined}>
            {failing.length
              ? `${failing.map((j) => j.name).join(', ')} failing: ${failing[0]!.lastError}`
              : `${s.jobs.length} running fine`}
          </dd>
        </dl>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { me, can } = useAdmin();
  const [series, setSeries] = useState<Series>('messages');
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.admin.stats, refetchInterval: 30_000 });
  const audit = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api.admin.auditLogs({ limit: 8 }),
    enabled: can('audit.view'),
    refetchInterval: 30_000,
  });
  const s = stats.data;
  const totalUsers = s ? Object.values(s.users).reduce((a, b) => a + b, 0) : 0;
  const values = s?.activity.map((d) => d[series]) ?? [];
  const periodTotal = values.reduce((a, b) => a + b, 0);

  return (
    <div className="page stack-lg">
      <PageHeader
        title={`${greeting()}, ${me.displayName.split(' ')[0]}`}
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        actions={
          <button className="btn" onClick={() => stats.refetch()} disabled={stats.isFetching}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
        }
      />
      <ErrorAlert error={stats.error} />

      {!me.twoFactorEnabled && (
        <motion.div
          className="admin-attention security"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Icon name="shield" size={18} />
          <span className="grow">
            <b>Protect your staff account.</b> Turn on two-step verification in the OVL For Business app:
            Settings → Security.
          </span>
        </motion.div>
      )}

      {s && s.pendingApplications + s.openTickets + s.pendingCashRequests > 0 && (
        <motion.div className="admin-attention" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Icon name="bell" size={18} />
          <span className="grow">
            Waiting for staff: <b>{plural(s.pendingApplications, 'application')}</b>,{' '}
            <b>{plural(s.openTickets, 'open ticket')}</b> and{' '}
            <b>{plural(s.pendingCashRequests, 'deposit or payout request', 'deposit or payout requests')}</b>.
          </span>
          {can('wallet.cash') && s.pendingCashRequests > 0 && (
            <Link className="btn sm" to="/cash">
              Handle
            </Link>
          )}
          {can('applications.view_all') && s.pendingApplications > 0 && (
            <Link className="btn sm" to="/applications">
              Review
            </Link>
          )}
          {can('support.answer') && s.openTickets > 0 && (
            <Link className="btn sm" to="/support">
              Answer
            </Link>
          )}
        </motion.div>
      )}

      {s ? (
        <Stagger className="admin-kpis" gap={0.05}>
          <StaggerItem>
            <Kpi
              to="/users"
              icon="users"
              label="Accounts"
              value={totalUsers}
              tone="var(--accent)"
              hint={`${s.users.user ?? 0} regular · ${totalUsers - (s.users.user ?? 0)} staff`}
            />
          </StaggerItem>
          <StaggerItem>
            <Kpi
              to="/applications"
              icon="review"
              label="Pending applications"
              value={s.pendingApplications}
              tone="var(--warning)"
            />
          </StaggerItem>
          <StaggerItem>
            <Kpi
              to="/support"
              icon="support"
              label="Open tickets"
              value={s.openTickets}
              tone="var(--danger)"
            />
          </StaggerItem>
          <StaggerItem>
            <Kpi
              to="/organizations"
              icon="building"
              label="Organizations"
              value={s.organizations}
              tone="var(--council)"
            />
          </StaggerItem>
          <StaggerItem>
            <Kpi
              to="/stock"
              icon="chart"
              label="Active listings"
              value={s.activeListings}
              tone="var(--success)"
            />
          </StaggerItem>
          <StaggerItem>
            <Kpi
              to="/registry"
              icon="book"
              label="Registry entries"
              value={s.registryEntries}
              tone="var(--moderator)"
            />
          </StaggerItem>
        </Stagger>
      ) : (
        stats.isLoading && (
          <div className="admin-kpis">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={116} />
            ))}
          </div>
        )
      )}

      {s && (
        <div className="admin-dash-grid">
          <div className="card stack">
            <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3>Platform activity</h3>
                <span className="small muted">
                  {periodTotal.toLocaleString()} {SERIES.find((x) => x.value === series)!.label.toLowerCase()}{' '}
                  in the last 14 days
                </span>
              </div>
              <Segmented<Series> value={series} onChange={setSeries} options={SERIES} />
            </div>
            <AreaChart
              key={series}
              values={values}
              labels={s.activity.map((d) =>
                new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                }),
              )}
              format={(v) => Math.round(v).toLocaleString()}
              height={220}
              label={`${series} per day`}
            />
            <div className="admin-axis">
              {s.activity
                .filter((_, i) => i % 3 === 1)
                .map((d) => (
                  <span key={d.date}>
                    {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                ))}
            </div>
          </div>

          <div className="card stack">
            <h3>Accounts by role</h3>
            <div className="stack-sm">
              {ROLES.map((r, i) => {
                const n = s.users[r] ?? 0;
                return (
                  <div key={r} className="admin-bar-row">
                    <span className="admin-bar-label">
                      <span className="dot" style={{ background: ROLE_COLORS[r] }} />
                      {ROLE_LABELS[r]}
                    </span>
                    <div className="admin-bar">
                      <motion.span
                        style={{ background: ROLE_COLORS[r] }}
                        initial={{ width: 0 }}
                        animate={{
                          width: `${totalUsers ? Math.max((n / totalUsers) * 100, n ? 3 : 0) : 0}%`,
                        }}
                        transition={{ delay: 0.1 + i * 0.05, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                    <span className="num small">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card stack">
            <div className="spread">
              <h3>Money on the platform</h3>
              {can('wallet.view_all') && (
                <Link to="/cash" className="small">
                  Cash desk →
                </Link>
              )}
            </div>
            {s.balances.length === 0 && <p className="small muted">No balances yet.</p>}
            <div className="stack-sm">
              {s.balances.map((b) => (
                <div key={b.currency} className="admin-money-row">
                  <span className="admin-currency">{b.currency}</span>
                  <div className="grow">
                    <div className="bold num">{formatMoney(b.total, b.currency)}</div>
                    <div className="tiny muted">{plural(b.wallets, 'wallet')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {can('audit.view') && <SystemCard />}
          {can('audit.view') && (
            <div className="card stack">
              <div className="spread">
                <h3>Recent staff actions</h3>
                <Link to="/audit" className="small">
                  Audit log →
                </Link>
              </div>
              <div className="stack-sm">
                {audit.data?.items.map((l) => (
                  <AuditRow key={l.id} log={l} />
                ))}
                {audit.data?.items.length === 0 && <p className="small muted">Nothing yet.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
