import { ROLE_LABELS } from '@ovl/shared';
import { Avatar, Badges, Empty, ErrorAlert, Field, formatDate, PageHeader } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { apiUrl } from '../config';
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notificationsSupported,
} from '../notifications';
import { Icon } from '../components/Icon';

function ProfileForm() {
  const me = useMe();
  const { reload } = useAuth();
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
    onSuccess: () => reload(),
  });
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>Profile</h3>
      <Field label="Display name">
        <input
          className="input"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          required
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
      {save.isSuccess && <div className="alert success">Saved</div>}
      <button className="btn primary" disabled={save.isPending}>
        Save
      </button>
    </form>
  );
}

function PasswordForm() {
  const { logout } = useAuth();
  const [form, setForm] = useState({ current: '', next: '' });
  const change = useMutation({
    mutationFn: () => api.me.changePassword(form.current, form.next),
    onSuccess: () => logout(),
  });
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate();
      }}
    >
      <h3>Password</h3>
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
      <Field label="New password" hint="Changing the password signs you out everywhere.">
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
      <button className="btn" disabled={change.isPending}>
        Change password
      </button>
    </form>
  );
}

function ApiKeys() {
  const queryClient = useQueryClient();
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
      <div className="row">
        <Icon name="key" />
        <h3>Developer API keys</h3>
      </div>
      <p className="small muted">
        Let your own services search the public registry and read stock data. Send the key as the{' '}
        <code>X-API-Key</code> header, e.g. <code>GET {base}/api/v1/registry?q=…</code>. Full reference:{' '}
        <a href={`${base}/api/docs`} target="_blank" rel="noreferrer">
          API docs
        </a>
        .
      </p>
      {create.data && (
        <div className="alert success stack-sm">
          <b>Copy your new key now — it is shown only once:</b>
          <code style={{ wordBreak: 'break-all' }}>{create.data.key}</code>
        </div>
      )}
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Key name, e.g. My website"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn">Create key</button>
      </form>
      <ErrorAlert error={create.error ?? revoke.error} />
      <div className="list">
        {keys.data?.map((k) => (
          <div key={k.id} className="list-item" style={{ cursor: 'default' }}>
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
      {keys.data?.length === 0 && <Empty title="No keys yet" />}
    </div>
  );
}

function NotificationSettings() {
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [denied, setDenied] = useState(notificationsSupported() && Notification.permission === 'denied');
  if (!notificationsSupported()) {
    return <p className="small muted">This device does not support notifications from the app yet.</p>;
  }
  return (
    <div className="stack-sm">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            if (e.target.checked) {
              const granted = await enableNotifications();
              setEnabled(granted);
              setDenied(!granted && Notification.permission === 'denied');
            } else {
              disableNotifications();
              setEnabled(false);
            }
          }}
        />
        Show a notification for new messages while the app is in the background
      </label>
      {denied && (
        <div className="alert warning small">
          Notifications are blocked for this site. Allow them in your browser settings, then try again.
        </div>
      )}
    </div>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'system');
  const choose = (value: string) => {
    setTheme(value);
    try {
      if (value === 'system') {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('ovl.theme');
      } else {
        document.documentElement.dataset.theme = value;
        localStorage.setItem('ovl.theme', value);
      }
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="row-wrap">
      {['system', 'light', 'dark'].map((t) => (
        <button key={t} className={`chip${theme === t ? ' active' : ''}`} onClick={() => choose(t)}>
          {t[0]!.toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function ProfilePage() {
  const me = useMe();
  const { logout } = useAuth();
  return (
    <div className="page stack-lg" style={{ maxWidth: 820 }}>
      <PageHeader
        title="Profile & settings"
        actions={
          <button className="btn" onClick={() => logout()}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        }
      />
      <div className="card row">
        <Avatar name={me.displayName} url={me.avatarUrl} size={64} />
        <div className="grow stack-sm">
          <div className="row-wrap">
            <h2>{me.displayName}</h2>
            <Badges badges={me.badges} />
          </div>
          <div className="small muted">
            @{me.username} · {me.email} · {ROLE_LABELS[me.role]}
          </div>
        </div>
      </div>
      <div className="card stack-sm">
        <h3>Appearance</h3>
        <ThemePicker />
      </div>
      <div className="card stack-sm">
        <div className="row">
          <Icon name="bell" />
          <h3>Notifications</h3>
        </div>
        <NotificationSettings />
      </div>
      <div className="grid-2">
        <ProfileForm />
        <PasswordForm />
      </div>
      <ApiKeys />
    </div>
  );
}
