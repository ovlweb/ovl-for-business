import { OvlApiError } from '@ovl/sdk';
import {
  BADGE_LABELS,
  getCurrency,
  isCurrency,
  WORKFLOWS,
  type Application,
  type Badge as BadgeKind,
  type UserSummary,
} from '@ovl/shared';
import { useEffect, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "1234567.5" + "USD" → "1,234,567.50 USD" without losing precision. */
export function formatMoney(amount: string, currency: string, withCode = true): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const decimals = isCurrency(currency) ? getCurrency(currency).decimals : fraction.length;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = decimals ? `.${fraction.padEnd(decimals, '0').slice(0, decimals)}` : '';
  return `${negative ? '−' : ''}${grouped}${frac}${withCode ? ` ${currency}` : ''}`;
}

export function formatDate(iso: string, withTime = true): string {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(iso, false);
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function errorMessage(error: unknown): string {
  if (error instanceof OvlApiError) {
    const details = error.details as
      { path?: string; message?: string }[] | { missing?: string[] } | undefined;
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => `${d.path?.replace(/^\//, '').replace(/\//g, '.') || 'input'}: ${d.message}`)
        .join('\n');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Spinner({ center }: { center?: boolean }) {
  return center ? (
    <div className="center">
      <div className="spinner" />
    </div>
  ) : (
    <div className="spinner" />
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert" style={{ whiteSpace: 'pre-line' }}>
      {errorMessage(error)}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  // Wrapping the control in <label> associates it with its label text (clicks, screen readers).
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          className={`tab${t.value === value ? ' active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  '#2d6cdf',
  '#7b4bd6',
  '#1f8a4c',
  '#cc3340',
  '#b86e00',
  '#0e8a8a',
  '#c2417a',
  '#5b6b8c',
];

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const background = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background }}>
      {url ? <img src={url} alt="" /> : initials || '?'}
    </span>
  );
}

export function Badge({ kind }: { kind: BadgeKind }) {
  return <span className={`badge ${kind}`}>{BADGE_LABELS[kind]}</span>;
}

export function Badges({ badges }: { badges: BadgeKind[] }) {
  return (
    <>
      {badges.map((b) => (
        <Badge key={b} kind={b} />
      ))}
    </>
  );
}

export function UserName({ user, showHandle }: { user: UserSummary; showHandle?: boolean }) {
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span className="bold ellipsis">{user.displayName}</span>
      {showHandle && <span className="muted small">@{user.username}</span>}
      <Badges badges={user.badges} />
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    {
      active: 'ok',
      approved: 'ok',
      open: 'info',
      pending: 'warn',
      halted: 'warn',
      suspended: 'bad',
      rejected: 'bad',
      revoked: 'bad',
      delisted: 'bad',
      closed: '',
      withdrawn: '',
    }[status] ?? '';
  return <span className={`badge ${tone}`}>{humanize(status)}</span>;
}

export function Money({
  amount,
  currency,
  className,
}: {
  amount: string;
  currency: string;
  className?: string;
}) {
  return <span className={`num nowrap ${className ?? ''}`}>{formatMoney(amount, currency)}</span>;
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export function WorkflowStepper({
  application,
}: {
  application: Pick<Application, 'type' | 'status' | 'stageIndex'>;
}) {
  const stages = WORKFLOWS[application.type].stages;
  return (
    <div className="stepper">
      {stages.map((stage, i) => {
        let state = '';
        if (application.status === 'approved' || i < application.stageIndex) state = 'done';
        else if (i === application.stageIndex && application.status === 'pending') state = 'current';
        else if (i === application.stageIndex && application.status === 'rejected') state = 'failed';
        return (
          <span key={stage.key} className={`step ${state}`}>
            <span className="dot">{state === 'done' ? '✓' : state === 'failed' ? '✕' : i + 1}</span>
            {stage.label}
          </span>
        );
      })}
    </div>
  );
}

/** Render an application payload as a definition list. */
export function PayloadView({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <dl className="dl">
      {entries.map(([key, value]) => (
        <FragmentRow key={key} label={humanize(key)} value={value} />
      ))}
    </dl>
  );
}

function FragmentRow({ label, value }: { label: string; value: unknown }) {
  let rendered: ReactNode;
  if (typeof value === 'boolean') rendered = value ? 'Yes' : 'No';
  else if (value && typeof value === 'object') {
    rendered = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
      .join('\n');
  } else rendered = String(value);
  return (
    <>
      <dt>{label}</dt>
      <dd>{rendered}</dd>
    </>
  );
}

/** Tiny dependency-free line chart for price history. */
export function Sparkline({
  values,
  width = 320,
  height = 80,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <div className="muted small">Not enough price history yet.</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - 6 - ((v - min) / span) * (height - 12)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
    >
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
