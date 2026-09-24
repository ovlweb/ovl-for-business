import { getTheme, ROLE_LABELS } from '@ovl/shared';
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
  PageHeader,
  Switch,
  ThemeGallery,
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

function SecuritySection() {
  const { logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '' });
  const change = useMutation({
    mutationFn: () => api.me.changePassword(form.current, form.next),
    onSuccess: async () => {
      toast.success('Password changed — please sign in again');
      await logout();
    },
  });
  return (
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
      <Field label="New password" hint="Changing the password signs this account out everywhere.">
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
