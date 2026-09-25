import {
  BADGE_LABELS,
  WORKFLOWS,
  type Application,
  type Badge as BadgeKind,
  type UserSummary,
} from '@ovl/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage, formatMoney, humanize } from './format';
import { Icon, type IconName } from './icons';

export const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

// ---------------------------------------------------------------------------
// Feedback
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

export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A few skeleton rows while a list loads. */
export function SkeletonList({ rows = 4, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="stack" style={{ padding: 16 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ opacity: 1 - i * 0.18 }}>
          {avatar && <Skeleton width={40} height={40} radius={20} />}
          <div className="grow stack-sm">
            <Skeleton width={`${55 + ((i * 17) % 30)}%`} height={13} />
            <Skeleton width={`${30 + ((i * 23) % 40)}%`} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  return (
    <AnimatePresence initial={false}>
      {!!error && (
        <motion.div
          className="alert error"
          role="alert"
          style={{ whiteSpace: 'pre-line' }}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <Icon name="info" size={18} style={{ flex: 'none', marginTop: 1 }} />
          <span>{errorMessage(error)}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ title, icon, children }: { title: string; icon?: IconName; children?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {icon && (
        <div className="empty-icon">
          <Icon name={icon} size={24} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

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

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="segmented" role="tablist" style={{ position: 'relative', isolation: 'isolate' }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className="segmented-thumb" transition={spring} />
          )}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <motion.div
      className="page-header"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        {icon && (
          <span className="page-icon">
            <Icon name={icon} size={22} />
          </span>
        )}
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </motion.div>
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
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={spring}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
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
  const id = useId();
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
          {t.value === value && (
            <motion.span layoutId={`tab-${id}`} className="tab-underline" transition={spring} />
          )}
        </button>
      ))}
    </div>
  );
}

/** Anchored dropdown panel that closes on outside click and Escape. */
export function Popover({
  open,
  onClose,
  children,
  style,
  placement = 'bottom',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
  placement?: 'top' | 'bottom';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className="popover"
          role="menu"
          style={style}
          initial={{ opacity: 0, y: placement === 'top' ? 8 : -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: placement === 'top' ? 8 : -8, scale: 0.97 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const AVATAR_GRADIENTS = [
  ['#2563EB', '#7C3AED'],
  ['#7C3AED', '#DB2777'],
  ['#059669', '#0EA5E9'],
  ['#DC2626', '#F59E0B'],
  ['#0891B2', '#2563EB'],
  ['#B45309', '#DC2626'],
  ['#4F46E5', '#06B6D4'],
  ['#475569', '#1E293B'],
];

export function Avatar({
  name,
  url,
  size = 36,
  squircle,
}: {
  name: string;
  url?: string | null;
  size?: number;
  squircle?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const [from, to] = AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
  return (
    <span
      className={`avatar${squircle ? ' squircle' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
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
    <span className="row" style={{ gap: 6, display: 'inline-flex', minWidth: 0 }}>
      <span className="bold ellipsis">{user.displayName}</span>
      {showHandle && <span className="muted small">@{user.username}</span>}
      <Badges badges={user.badges} />
    </span>
  );
}

const STATUS_TONES: Record<string, string> = {
  active: 'ok',
  approved: 'ok',
  completed: 'ok',
  confirmed: 'ok',
  verified: 'ok',
  paid: 'ok',
  open: 'info',
  pending: 'warn',
  changes_requested: 'warn',
  awaiting_approval: 'warn',
  waiting_for_approval: 'warn',
  renewal_pending: 'info',
  delivered: 'ok',
  failed: 'bad',
  expired: 'bad',
  partly_paid: 'info',
  paused: 'warn',
  ended: '',
  not_confirmed: 'warn',
  overdue: 'bad',
  halted: 'warn',
  suspended: 'bad',
  rejected: 'bad',
  declined: 'bad',
  revoked: 'bad',
  delisted: 'bad',
};

const DECISIONS: Record<string, [string, string]> = {
  approve: ['ok', 'Approved'],
  reject: ['bad', 'Rejected'],
  request_changes: ['warn', 'Changes requested'],
};

/** "Verified business": the company's owner passed an identity check. */
export function VerifiedBadge({ compact }: { compact?: boolean }) {
  return (
    <span className="badge verified" title="Verified business: the owner passed an identity check">
      <Icon name="shield" size={12} />
      {compact ? 'Verified' : 'Verified business'}
    </span>
  );
}

/** A reviewer's decision on an application stage. */
export function DecisionBadge({ decision }: { decision: string }) {
  const [tone, label] = DECISIONS[decision] ?? ['', decision];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_TONES[status] ?? ''}`}>
      <span className="dot" />
      {humanize(status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

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

/**
 * Counts up to a decimal string ("12840.50") with an ease-out; the final frame shows the exact
 * value, so money is never displayed rounded.
 */
export function AnimatedNumber({
  value,
  format = (v) => v,
  duration = 900,
}: {
  value: string;
  format?: (value: string) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const previous = useRef<number>(0);
  useEffect(() => {
    const target = Number(value);
    const decimals = value.includes('.') ? value.split('.')[1]!.length : 0;
    const from = previous.current;
    previous.current = target;
    if (!Number.isFinite(target) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      if (t < 1) {
        setShown((from + (target - from) * eased).toFixed(decimals));
        frame = requestAnimationFrame(tick);
      } else {
        setShown(value);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span className="num">{format(shown)}</span>;
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
            <span className="dot">
              {state === 'done' ? (
                <Icon name="check" size={13} />
              ) : state === 'failed' ? (
                <Icon name="x" size={13} />
              ) : (
                i + 1
              )}
            </span>
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
      {entries.map(([key, value]) => {
        let rendered: ReactNode;
        if (typeof value === 'boolean') rendered = value ? 'Yes' : 'No';
        else if (value && typeof value === 'object') {
          rendered = Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
            .join('\n');
        } else rendered = String(value);
        return (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{humanize(key)}</dt>
            <dd>{rendered}</dd>
          </div>
        );
      })}
    </dl>
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
