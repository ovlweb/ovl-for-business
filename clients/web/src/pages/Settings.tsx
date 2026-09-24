import { getTheme, ROLE_LABELS, type Session } from '@ovl/shared';
import {
  applyTheme,
  Avatar,
  Badges,
  Empty,
  ErrorAlert,
  Field,
  formatDate,
  getThemePreference,
  Icon,
  Modal,
  PageHeader,
  plural,
  SkeletonList,
  Switch,
  ThemeGallery,
  timeAgo,
  useToast,
  type IconName,
} from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { apiUrl } from '../config';
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notificationsSupported,
} from '../notifications';

type Section = 'profile' | 'appearance' | 'notifications' | 'accounts' | 'security' | 'developer';

const SECTIONS: { id: Section; label: string; icon: IconName; hint: string }[] = [
  { id: 'profile', label: 'Profile', icon: 'user', hint: 'Name, bio and avatar' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', hint: 'Themes' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', hint: 'Background alerts' },
  { id: 'accounts', label: 'Accounts', icon: 'users', hint: 'Switch or add accounts' },
  { id: 'security', label: 'Security', icon: 'lock', hint: 'Password and sessions' },
  { id: 'developer', label: 'Developer', icon: 'key', hint: 'API keys' },
];

function ProfileSection() {
  const me = useMe();
  const { reload } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: me.displayName,
    bio: me.bio,
    avatarUrl: me.avatarUrl ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.me.update({
        displayName: form.displayName,
        bio: form.bio,
        avatarUrl: form.avatarUrl.trim() || null,
      }),
    onSuccess: async () => {
      await reload();
      toast.success('Profile saved');
    },
  });
  return (
    <div className="stack-lg">
      <div className="card profile-card">
        <div className="profile-cover" />
        <div className="row" style={{ gap: 16, alignItems: 'flex-end', marginTop: -44 }}>
          <div className="profile-avatar-ring">
            <Avatar name={form.displayName || me.username} url={form.avatarUrl || null} size={84} />
          </div>
          <div className="grow stack-sm" style={{ paddingBottom: 4 }}>
            <div className="row-wrap">
              <h2>{form.displayName || me.displayName}</h2>
              <Badges badges={me.badges} />
            </div>
            <div className="small muted">
              @{me.username} · {me.email} · {ROLE_LABELS[me.role]} · member since{' '}
              {formatDate(me.createdAt, false)}
            </div>
          </div>
        </div>
      </div>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Display name">
          <input
            className="input"
            value={form.displayName}
            required
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <Field label="Bio">
          <textarea
            className="textarea"
            value={form.bio}
            maxLength={500}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </Field>
        <Field label="Avatar URL">
          <input
            className="input"
            type="url"
            value={form.avatarUrl}
            onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
          />
        </Field>
        <ErrorAlert error={save.error} />
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>
          Save profile
        </button>
      </form>
    </div>
  );
}

function AppearanceSection() {
  const { updatePreferences } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState(getThemePreference);
  return (
    <div className="card stack-lg">
      <div className="stack-sm">
        <h3>Theme</h3>
        <p className="small muted">
          Your theme is saved to your account, so the web app, the admin panel and the mobile and desktop apps
          use it too.
        </p>
      </div>
      <ThemeGallery
        value={value}
        onChange={(id, origin) => {
          setValue(id);
          applyTheme(id, { origin });
          updatePreferences({ theme: id })
            .then(() =>
              toast.success(
                id === 'system' ? 'Following your system theme' : `${getTheme(id).name} theme applied`,
              ),
            )
            .catch(toast.error);
        }}
      />
    </div>
  );
}

function NotificationsSection() {
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [denied, setDenied] = useState(notificationsSupported() && Notification.permission === 'denied');
  return (
    <div className="card stack">
      <div className="setting-row">
        <span className="kpi-icon">
          <Icon name="bell" size={17} />
        </span>
        <div className="grow">
          <b>Message notifications</b>
          <div className="small muted">
            Show a notification for new messages while the app is in the background.
          </div>
        </div>
        {notificationsSupported() ? (
          <Switch
            label="Message notifications"
            checked={enabled}
            onChange={async (on) => {
              if (on) {
                const granted = await enableNotifications();
                setEnabled(granted);
                setDenied(!granted && Notification.permission === 'denied');
              } else {
                disableNotifications();
                setEnabled(false);
              }
            }}
          />
        ) : (
          <span className="small muted">Not supported here</span>
        )}
      </div>
      {denied && (
        <div className="alert warning small">
          Notifications are blocked for this site. Allow them in your browser settings.
        </div>
      )}
    </div>
  );
}

function AccountsSection() {
  const me = useMe();
  const { accounts, switchAccount, startAddAccount, logout } = useAuth();
  return (
    <div className="card stack">
      <div className="stack-sm">
        <h3>Accounts on this device</h3>
        <p className="small muted">
          Stay signed in to several accounts — for example your personal and a staff account — and switch
          instantly.
        </p>
      </div>
      <div className="list card pad-0">
        {accounts.map((a) => (
          <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
            <Avatar name={a.displayName} url={a.avatarUrl} size={38} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <b>{a.displayName}</b>
                <Badges badges={a.badges} />
              </div>
              <div className="small muted">
                @{a.username} · {ROLE_LABELS[a.role]}
              </div>
            </div>
            {a.id === me.id ? (
              <span className="badge ok">
                <span className="dot" />
                Active
              </span>
            ) : (
              <button className="btn sm" onClick={() => switchAccount(a.id)}>
                Switch
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="row-wrap">
        <button className="btn primary" onClick={startAddAccount}>
          <Icon name="userPlus" size={16} /> Add account
        </button>
        <button className="btn" onClick={() => logout()}>
          <Icon name="logout" size={16} /> Sign out of @{me.username}
        </button>
      </div>
    </div>
  );
}

const DEVICE_ICONS: Record<Session['kind'], IconName> = {
  desktop: 'monitor',
  mobile: 'smartphone',
  tablet: 'tablet',
  app: 'smartphone',
  api: 'terminal',
  unknown: 'globe',
};

function SessionsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.me.sessions });
  const signOut = useMutation({
    mutationFn: (id: string) => api.me.signOutSession(id),
    onSuccess: () => {
      toast.success('Device signed out');
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const signOutOthers = useMutation({
    mutationFn: api.me.signOutOtherSessions,
    onSuccess: (r) => {
      toast.success(
        r.signedOut ? `Signed out ${plural(r.signedOut, 'other device')}` : 'No other devices were signed in',
      );
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  return (
    <div className="card stack">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h3>Signed-in devices</h3>
          <p className="small muted">
            Every browser and app where this account is signed in. Sign out anything you do not recognise — it
            stops working immediately.
          </p>
        </div>
        {others > 0 && (
          <button
            className="btn sm"
            onClick={() => signOutOthers.mutate()}
            disabled={signOutOthers.isPending}
          >
            <Icon name="logout" size={15} /> Sign out all other devices
          </button>
        )}
      </div>
      <ErrorAlert error={sessions.error ?? signOut.error ?? signOutOthers.error} />
      {sessions.isLoading && <SkeletonList rows={2} avatar={false} />}
      <div className="list card pad-0">
        {sessions.data?.map((s) => (
          <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
            <span className="kpi-icon">
              <Icon name={DEVICE_ICONS[s.kind]} size={18} />
            </span>
            <div className="grow">
              <div className="row" style={{ gap: 8 }}>
                <b>{s.device}</b>
                {s.current && (
                  <span className="badge ok">
                    <span className="dot" />
                    This device
                  </span>
                )}
              </div>
              <div className="small muted">
                {s.ip ? `${s.ip} · ` : ''}
                {s.current ? 'Active now' : `Last active ${timeAgo(s.lastUsedAt)}`} · signed in{' '}
                {formatDate(s.createdAt, false)}
              </div>
            </div>
            {!s.current && (
              <button
                className="btn sm"
                aria-label={`Sign out ${s.device}`}
                onClick={() => signOut.mutate(s.id)}
                disabled={signOut.isPending}
              >
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const text = `OVL For Business recovery codes\n\n${codes.join('\n')}\n\nEach code signs in once.`;
  return (
    <div className="stack">
      <div className="alert warning small">
        <Icon name="info" size={17} />
        <span>
          Save these codes somewhere safe. Each one signs you in once if you lose your phone. They are shown
          only now.
        </span>
      </div>
      <div className="recovery-grid">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <div className="row-wrap">
        <button
          type="button"
          className="btn"
          onClick={() =>
            navigator.clipboard?.writeText(text).then(() => toast.success('Recovery codes copied'))
          }
        >
          <Icon name="copy" size={16} /> Copy
        </button>
        <a
          className="btn"
          download="ovl-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        >
          <Icon name="download" size={16} /> Download
        </a>
        <button type="button" className="btn primary" onClick={onDone}>
          I saved them
        </button>
      </div>
    </div>
  );
}

function EnableTwoFactor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const setup = useQuery({
    queryKey: ['2fa', 'setup'],
    queryFn: api.me.twoFactor.setup,
    staleTime: Infinity,
    gcTime: 0,
  });
  const enable = useMutation({
    mutationFn: () => api.me.twoFactor.enable(code),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      return queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
    },
  });
  return (
    <Modal title={codes ? 'Save your recovery codes' : 'Turn on two-step verification'} onClose={onClose}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          <ol className="steps small">
            <li>
              Install an authenticator app — Google Authenticator, 1Password, Authy, Microsoft Authenticator…
            </li>
            <li>Scan this QR code with it, or type the key.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <ErrorAlert error={setup.error} />
          <div className="qr-row">
            {setup.data ? (
              <img
                className="qr"
                src={setup.data.qr}
                alt="QR code for your authenticator app"
                width={180}
                height={180}
              />
            ) : (
              <div className="qr skeleton" />
            )}
            <div className="stack-sm grow">
              <span className="small muted">Key for manual entry</span>
              <code className="secret">{setup.data?.secret.match(/.{1,4}/g)?.join(' ') ?? '…'}</code>
            </div>
          </div>
          <Field label="Code from the app">
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </Field>
          <ErrorAlert error={enable.error} />
          <button className="btn primary" disabled={code.length !== 6 || enable.isPending || !setup.data}>
            Turn on
          </button>
        </form>
      )}
    </Modal>
  );
}

function TwoFactorCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['2fa', 'status'], queryFn: api.me.twoFactor.status });
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'codes' | null>(null);
  const [form, setForm] = useState({ password: '', code: '' });
  const [codes, setCodes] = useState<string[] | null>(null);
  const close = () => {
    setDialog(null);
    setCodes(null);
    setForm({ password: '', code: '' });
  };
  const disable = useMutation({
    mutationFn: () => api.me.twoFactor.disable(form.password, form.code),
    onSuccess: () => {
      toast.success('Two-step verification is off');
      close();
      return queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
    },
  });
  const renew = useMutation({
    mutationFn: () => api.me.twoFactor.newRecoveryCodes(form.code),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      return queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
    },
  });
  const s = status.data;
  return (
    <div className="card stack">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="kpi-icon">
            <Icon name="shield" size={18} />
          </span>
          <div className="stack-sm">
            <div className="row" style={{ gap: 8 }}>
              <h3>Two-step verification</h3>
              {s && (
                <span className={`badge ${s.enabled ? 'ok' : 'warn'}`}>
                  <span className="dot" />
                  {s.enabled ? 'On' : 'Off'}
                </span>
              )}
            </div>
            <p className="small muted">
              {s?.enabled
                ? `Signing in asks for a code from your authenticator app. On since ${formatDate(s.enabledAt!, false)} · ${plural(s.recoveryCodesLeft, 'recovery code')} left.`
                : 'Protect the account with a code from an authenticator app, so a stolen password is not enough.'}
            </p>
          </div>
        </div>
        {s &&
          (s.enabled ? (
            <div className="row-wrap">
              <button className="btn sm" onClick={() => setDialog('codes')}>
                New recovery codes
              </button>
              <button className="btn sm danger" onClick={() => setDialog('disable')}>
                Turn off
              </button>
            </div>
          ) : (
            <button className="btn primary sm" onClick={() => setDialog('enable')}>
              Turn on
            </button>
          ))}
      </div>
      <ErrorAlert error={status.error} />
      {dialog === 'enable' && <EnableTwoFactor onClose={close} />}
      {dialog === 'codes' && (
        <Modal title="New recovery codes" onClose={close}>
          {codes ? (
            <RecoveryCodes codes={codes} onDone={close} />
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                renew.mutate();
              }}
            >
              <p className="small muted">
                Your old recovery codes stop working. Confirm with a code from the app.
              </p>
              <Field label="Authentication or recovery code">
                <input
                  className="input"
                  autoComplete="one-time-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </Field>
              <ErrorAlert error={renew.error} />
              <button className="btn primary" disabled={renew.isPending}>
                Create new codes
              </button>
            </form>
          )}
        </Modal>
      )}
      {dialog === 'disable' && (
        <Modal title="Turn off two-step verification" onClose={close}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate();
            }}
          >
            <p className="small muted">Your account will be protected by the password only.</p>
            <Field label="Password">
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </Field>
            <Field label="Authentication or recovery code">
              <input
                className="input"
                autoComplete="one-time-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
            </Field>
            <ErrorAlert error={disable.error} />
            <button className="btn danger" disabled={disable.isPending}>
              Turn off
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function SecuritySection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '' });
  const change = useMutation({
    mutationFn: () => api.me.changePassword(form.current, form.next),
    onSuccess: () => {
      toast.success('Password changed — your other devices were signed out');
      setForm({ current: '', next: '' });
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  return (
    <div className="stack-lg">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <h3>Change password</h3>
        <Field label="Current password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
            required
          />
        </Field>
        <Field label="New password" hint="Every other device is signed out; this one stays signed in.">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
            required
          />
        </Field>
        <ErrorAlert error={change.error} />
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={change.isPending}>
          Change password
        </button>
      </form>
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}

function DeveloperSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const keys = useQuery({ queryKey: ['apiKeys'], queryFn: api.apiKeys.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
  const create = useMutation({
    mutationFn: () => api.apiKeys.create(name),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: api.apiKeys.revoke, onSuccess: refresh });
  const base = apiUrl() || location.origin;
  return (
    <div className="card stack">
      <h3>Developer API keys</h3>
      <p className="small muted">
        Let your own services search the public registry and read stock data. Send the key as the{' '}
        <code>X-API-Key</code> header, e.g. <code>GET {base}/api/v1/registry?q=…</code> — full reference in
        the{' '}
        <a href={`${base}/api/docs`} target="_blank" rel="noreferrer">
          API docs
        </a>
        .
      </p>
      <AnimatePresence>
        {create.data && (
          <motion.div
            className="alert success stack-sm"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="grow stack-sm">
              <b>Copy your new key now — it is shown only once:</b>
              <code style={{ wordBreak: 'break-all' }}>{create.data.key}</code>
            </div>
            <button
              className="btn sm"
              onClick={() =>
                navigator.clipboard?.writeText(create.data!.key).then(() => toast.success('Key copied'))
              }
            >
              <Icon name="copy" size={14} /> Copy
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder="Key name, e.g. My website"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn primary">Create key</button>
      </form>
      <ErrorAlert error={create.error ?? revoke.error} />
      <div className="list">
        {keys.data?.map((k) => (
          <div key={k.id} className="list-item" style={{ cursor: 'default' }}>
            <span className="kpi-icon">
              <Icon name="key" size={16} />
            </span>
            <div className="grow">
              <div className="bold">{k.name}</div>
              <div className="small muted">
                <code>{k.prefix}…</code> · created {formatDate(k.createdAt, false)}
                {k.lastUsedAt && ` · last used ${formatDate(k.lastUsedAt)}`}
              </div>
            </div>
            {k.revokedAt ? (
              <span className="badge bad">Revoked</span>
            ) : (
              <button className="btn sm ghost" onClick={() => revoke.mutate(k.id)}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
      {keys.data?.length === 0 && <Empty icon="key" title="No keys yet" />}
    </div>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const section = (SECTIONS.find((s) => s.id === params.get('section'))?.id ?? 'profile') as Section;
  return (
    <div className="page">
      <PageHeader
        icon="settings"
        title="Settings"
        subtitle="Your profile, appearance, accounts and developer access."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-link${s.id === section ? ' active' : ''}`}
              onClick={() => setParams({ section: s.id })}
            >
              {s.id === section && (
                <motion.span
                  layoutId="settings-active"
                  className="settings-active"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon name={s.icon} size={18} />
              <span className="stack-sm" style={{ gap: 0 }}>
                <span>{s.label}</span>
                <span className="tiny muted">{s.hint}</span>
              </span>
            </button>
          ))}
        </nav>
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            className="grow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            {section === 'profile' && <ProfileSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'notifications' && <NotificationsSection />}
            {section === 'accounts' && <AccountsSection />}
            {section === 'security' && <SecuritySection />}
            {section === 'developer' && <DeveloperSection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
