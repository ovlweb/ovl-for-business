import {
  getTheme,
  IDENTITY_DOCUMENTS,
  ROLE_LABELS,
  WEBHOOK_EVENTS,
  type FileInfo,
  type Session,
  type WebhookEndpoint,
} from '@ovl/shared';
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
  addPasskey,
  AttachmentPicker,
  passkeyCancelled,
  passkeysSupported,
  RecoveryCodes,
  StatusBadge,
  SkeletonList,
  Switch,
  ThemeGallery,
  TwoFactorSetupForm,
  timeAgo,
  useToast,
  type IconName,
  t,
  LanguagePicker,
  msg,
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
import { disablePush, enablePush, pushDeviceId, pushSupported } from '../push';

type Section =
  'profile' | 'appearance' | 'notifications' | 'accounts' | 'security' | 'identity' | 'developer';

const SECTIONS: { id: Section; label: string; icon: IconName; hint: string }[] = [
  { id: 'profile', label: msg('Profile'), icon: 'user', hint: msg('Name, bio and avatar') },
  { id: 'appearance', label: 'Appearance', icon: 'palette', hint: 'Themes' },
  { id: 'notifications', label: msg('Notifications'), icon: 'bell', hint: msg('Push and background alerts') },
  { id: 'accounts', label: msg('Accounts'), icon: 'users', hint: msg('Switch or add accounts') },
  { id: 'security', label: msg('Security'), icon: 'lock', hint: msg('Password and sessions') },
  { id: 'identity', label: msg('Identity'), icon: 'shield', hint: msg('Verification for company owners') },
  { id: 'developer', label: 'Developer', icon: 'key', hint: 'API keys, webhooks' },
];

/** The account's email: confirmed or not, send the link again, or change the address. */
function EmailCard() {
  const me = useMe();
  const { reload } = useAuth();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const resend = useMutation({
    mutationFn: api.me.resendVerification,
    onSuccess: () => toast.success(t('Link sent to {0}', me.email)),
  });
  const change = useMutation({
    mutationFn: () => api.me.changeEmail(form.email, form.password),
    onSuccess: async (updated) => {
      await reload();
      setChanging(false);
      setForm({ email: '', password: '' });
      toast.success(t('Check {0} for a confirmation link', updated.email));
    },
  });
  return (
    <div className="card stack">
      <div className="spread">
        <div>
          <h3>{t('Email')}</h3>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span>{me.email}</span>
            <StatusBadge status={me.emailVerified ? 'confirmed' : 'not_confirmed'} />
          </div>
        </div>
        {!changing && (
          <button className="btn" onClick={() => setChanging(true)}>
            {t('Change email')}
          </button>
        )}
      </div>
      {!me.emailVerified && !changing && (
        <div className="alert warning small">
          <Icon name="info" size={16} />
          <span className="grow">
            {t(
              'Confirm your address with the link we emailed you. Applications for companies and licenses need a confirmed email.',
            )}
          </span>
          <button className="btn sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
            {t('Send the link again')}
          </button>
        </div>
      )}
      <ErrorAlert error={resend.error} />
      {changing && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <div className="grid-2">
            <Field label={t('New email')}>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoFocus
                required
              />
            </Field>
            <Field label={t('Your password')}>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </Field>
          </div>
          <ErrorAlert error={change.error} />
          <div className="row-wrap">
            <button className="btn primary" disabled={change.isPending}>
              {t('Change and send a confirmation link')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setChanging(false)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

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
      toast.success(t('Profile saved'));
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
              {t(
                '@{0} · {1} · {2} · member since {3}',
                me.username,
                me.email,
                ROLE_LABELS[me.role],
                formatDate(me.createdAt, false),
              )}
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
        <Field label={t('Display name')}>
          <input
            className="input"
            value={form.displayName}
            required
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <Field label={t('Bio')}>
          <textarea
            className="textarea"
            value={form.bio}
            maxLength={500}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </Field>
        <Field label={t('Avatar URL')}>
          <input
            className="input"
            type="url"
            value={form.avatarUrl}
            onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
          />
        </Field>
        <ErrorAlert error={save.error} />
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>
          {t('Save profile')}
        </button>
      </form>
      <EmailCard />
    </div>
  );
}

function AppearanceSection() {
  const { updatePreferences } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState(getThemePreference);
  return (
    <div className="card stack-lg">
      <div className="setting-row">
        <span className="kpi-icon">
          <Icon name="globe" size={17} />
        </span>
        <div className="grow">
          <b>{t('Language')}</b>
          <div className="small muted">
            {t('For the web app, the admin panel and the apps on every device.')}
          </div>
        </div>
        <LanguagePicker onChange={(locale) => void updatePreferences({ locale }).catch(toast.error)} />
      </div>
      <div className="stack-sm">
        <h3>{t('Theme')}</h3>
        <p className="small muted">
          {t(
            'Your theme is saved to your account, so the web app, the admin panel and the mobile and desktop apps use it too.',
          )}
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
                id === 'system'
                  ? t('Following your system theme')
                  : t('{0} theme applied', getTheme(id).name),
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
          <b>{t('Message notifications')}</b>
          <div className="small muted">
            {t('Show a notification for new messages while the app is in the background.')}
          </div>
        </div>
        {notificationsSupported() ? (
          <Switch
            label={t('Message notifications')}
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
          <span className="small muted">{t('Not supported here')}</span>
        )}
      </div>
      {denied && (
        <div className="alert warning small">
          {t('Notifications are blocked for this site. Allow them in your browser settings.')}
        </div>
      )}
      <PushRows />
      <StatementEmailsRow />
      <ReadReceiptsRow />
    </div>
  );
}

/** Push notifications to this browser while you are away, and the devices that get them. */
function PushRows() {
  const me = useMe();
  const { updatePreferences } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: api.notifications.devices });
  const thisDevice = pushDeviceId(me.id);
  const onHere = !!thisDevice && !!devices.data?.some((d) => d.id === thisDevice);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['push-devices'] });
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(me.id) : disablePush(me.id)),
    onSuccess: (_, on) => {
      refresh();
      toast.success(
        on ? t('Push notifications on for this browser') : t('Push notifications off for this browser'),
      );
    },
    onError: toast.error,
  });
  const test = useMutation({
    mutationFn: api.notifications.test,
    onSuccess: (r) =>
      r.delivered
        ? toast.success(t('Sent to {0} of {1} devices', r.delivered, r.devices))
        : toast.error(
            r.devices ? t('No device took the test notification') : t('Turn push notifications on first'),
          ),
    onError: toast.error,
  });
  const remove = useMutation({ mutationFn: api.notifications.removeDevice, onSuccess: refresh });
  return (
    <>
      <div className="setting-row">
        <span className="kpi-icon">
          <Icon name="smartphone" size={17} />
        </span>
        <div className="grow">
          <b>{t('Push notifications on this browser')}</b>
          <div className="small muted">
            {t(
              'Mentions, payments, invoices and approvals reach you even when OVL For Business is closed. One account per browser gets them: the one that turned them on last.',
            )}
          </div>
        </div>
        {pushSupported() ? (
          <Switch
            label={t('Push notifications on this browser')}
            checked={onHere}
            disabled={toggle.isPending}
            onChange={(on) => toggle.mutate(on)}
          />
        ) : (
          <span className="small muted">{t('Not supported here')}</span>
        )}
      </div>
      <div className="setting-row">
        <span className="kpi-icon">
          <Icon name="chat" size={17} />
        </span>
        <div className="grow">
          <b>{t('Push new messages')}</b>
          <div className="small muted">{t('Also push direct and group messages while you are away.')}</div>
        </div>
        <Switch
          label={t('Push new messages')}
          checked={me.preferences.pushChats !== false}
          onChange={(value) =>
            updatePreferences({ pushChats: value })
              .then(() => toast.success(value ? t('Message pushes on') : t('Message pushes off')))
              .catch(toast.error)
          }
        />
      </div>
      {!!devices.data?.length && (
        <div className="stack-sm">
          <div className="spread">
            <b className="small">{t('Devices with push notifications')}</b>
            <button className="btn sm" disabled={test.isPending} onClick={() => test.mutate()}>
              {t('Send a test')}
            </button>
          </div>
          {devices.data.map((d) => (
            <div key={d.id} className="row small">
              <Icon name={d.kind === 'webpush' ? 'monitor' : 'smartphone'} size={15} />
              <span className="grow ellipsis">
                {d.label || d.kind}
                {d.id === thisDevice && <span className="muted">{t('· this browser')}</span>}
              </span>
              <span className="muted nowrap">
                {d.lastUsedAt ? t('last push {0}', formatDate(d.lastUsedAt)) : t('no pushes yet')}
              </span>
              <button
                className="btn ghost icon sm"
                aria-label={t('Remove {0}', d.label || d.kind)}
                onClick={() => remove.mutate(d.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatementEmailsRow() {
  const me = useMe();
  const { updatePreferences } = useAuth();
  const toast = useToast();
  const on = !!me.preferences.statementEmails;
  return (
    <div className="setting-row">
      <span className="kpi-icon">
        <Icon name="file" size={17} />
      </span>
      <div className="grow">
        <b>{t('Monthly statements by email')}</b>
        <div className="small muted">
          {t('At the start of each month, get a PDF statement of every balance you can see that moved.')}
          {!me.emailVerified && ` ${t('Confirm your email address first.')}`}
        </div>
      </div>
      <Switch
        label={t('Monthly statements by email')}
        checked={on}
        onChange={(value) =>
          updatePreferences({ statementEmails: value })
            .then(() => toast.success(value ? t('Monthly statements on') : t('Monthly statements off')))
            .catch(toast.error)
        }
      />
    </div>
  );
}

function ReadReceiptsRow() {
  const me = useMe();
  const { updatePreferences } = useAuth();
  const toast = useToast();
  const on = me.preferences.readReceipts !== false;
  return (
    <div className="setting-row">
      <span className="kpi-icon">
        <Icon name="checkCheck" size={17} />
      </span>
      <div className="grow">
        <b>{t('Read receipts')}</b>
        <div className="small muted">
          {t(
            'Show others when you have read their messages in direct chats and groups. When off, you do not see theirs either.',
          )}
        </div>
      </div>
      <Switch
        label={t('Read receipts')}
        checked={on}
        onChange={(value) =>
          updatePreferences({ readReceipts: value })
            .then(() => toast.success(value ? t('Read receipts on') : t('Read receipts off')))
            .catch(toast.error)
        }
      />
    </div>
  );
}

function AccountsSection() {
  const me = useMe();
  const { accounts, switchAccount, startAddAccount, logout } = useAuth();
  return (
    <div className="card stack">
      <div className="stack-sm">
        <h3>{t('Accounts on this device')}</h3>
        <p className="small muted">
          {t(
            'Stay signed in to several accounts — for example your personal and a staff account — and switch instantly.',
          )}
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
                @{a.username} · {t(ROLE_LABELS[a.role])}
              </div>
            </div>
            {a.id === me.id ? (
              <span className="badge ok">
                <span className="dot" />
                {t('Active')}
              </span>
            ) : (
              <button className="btn sm" onClick={() => switchAccount(a.id)}>
                {t('Switch')}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="row-wrap">
        <button className="btn primary" onClick={startAddAccount}>
          <Icon name="userPlus" size={16} /> {t('Add account')}
        </button>
        <button className="btn" onClick={() => logout()}>
          <Icon name="logout" size={16} /> {t('Sign out of @{0}', me.username)}
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
      toast.success(t('Device signed out'));
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const signOutOthers = useMutation({
    mutationFn: api.me.signOutOtherSessions,
    onSuccess: (r) => {
      toast.success(
        r.signedOut
          ? t('Signed out {0}', plural(r.signedOut, 'other device'))
          : t('No other devices were signed in'),
      );
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  return (
    <div className="card stack">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h3>{t('Signed-in devices')}</h3>
          <p className="small muted">
            {t(
              'Every browser and app where this account is signed in. Sign out anything you do not recognise — it stops working immediately.',
            )}
          </p>
        </div>
        {others > 0 && (
          <button
            className="btn sm"
            onClick={() => signOutOthers.mutate()}
            disabled={signOutOthers.isPending}
          >
            <Icon name="logout" size={15} /> {t('Sign out all other devices')}
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
                    {t('This device')}
                  </span>
                )}
              </div>
              <div className="small muted">
                {t(
                  '{0}{1} · signed in {2}',
                  s.ip ? `${s.ip} · ` : '',
                  s.current ? 'Active now' : `Last active ${timeAgo(s.lastUsedAt)}`,
                  formatDate(s.createdAt, false),
                )}
              </div>
            </div>
            {!s.current && (
              <button
                className="btn sm"
                aria-label={t('Sign out {0}', s.device)}
                onClick={() => signOut.mutate(s.id)}
                disabled={signOut.isPending}
              >
                {t('Sign out')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EnableTwoFactor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const [enabled, setEnabled] = useState(false);
  return (
    <Modal
      title={enabled ? t('Save your recovery codes') : t('Turn on two-step verification')}
      onClose={onClose}
    >
      <TwoFactorSetupForm
        load={api.me.twoFactor.setup}
        enable={api.me.twoFactor.enable}
        onEnabled={() => setEnabled(true)}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
          void reload();
          onClose();
        }}
      />
    </Modal>
  );
}

function defaultPasskeyName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

function PasskeysCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: api.me.passkeys.list });
  const [name, setName] = useState(defaultPasskeyName);
  const add = useMutation({
    mutationFn: () => addPasskey(api, name.trim() || defaultPasskeyName()),
    onSuccess: (key) => {
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] });
      toast.success(t('Passkey "{0}" added', key.name));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.me.passkeys.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  });
  const supported = passkeysSupported();
  return (
    <div className="card stack">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="kpi-icon" style={{ width: 42, height: 42 }}>
          <Icon name="key" size={19} />
        </span>
        <div className="grow">
          <h3>{t('Passkeys')}</h3>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {t(
              'Sign in with your fingerprint, face or device PIN instead of a password. Passkeys cannot be phished and are stored by your device or password manager.',
            )}
          </p>
        </div>
      </div>
      {keys.data?.map((k) => (
        <div key={k.id} className="spread passkey-row">
          <div>
            <b>{k.name}</b>
            <div className="small muted">
              {t(
                'Added {0}{1}{2}',
                formatDate(k.createdAt, false),
                k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : ' · not used yet',
                k.backedUp ? ' · synced' : '',
              )}
            </div>
          </div>
          <button
            className="btn ghost sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate(k.id)}
            aria-label={t('Remove {0}', k.name)}
          >
            <Icon name="trash" size={15} /> {t('Remove')}
          </button>
        </div>
      ))}
      <ErrorAlert error={add.error && !passkeyCancelled(add.error) ? add.error : remove.error} />
      {supported ? (
        <form
          className="row-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 260 }}
            aria-label={t('Passkey name')}
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" disabled={add.isPending}>
            <Icon name="plus" size={16} /> {t('Add a passkey')}
          </button>
        </form>
      ) : (
        <p className="small muted">{t('This browser does not support passkeys.')}</p>
      )}
    </div>
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
      toast.success(t('Two-step verification is off'));
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
              <h3>{t('Two-step verification')}</h3>
              {s && (
                <span className={`badge ${s.enabled ? 'ok' : 'warn'}`}>
                  <span className="dot" />
                  {s.enabled ? t('On') : t('Off')}
                </span>
              )}
            </div>
            <p className="small muted">
              {s?.enabled
                ? t(
                    'Signing in asks for a code from your authenticator app. On since {0} · {1} left.',
                    formatDate(s.enabledAt!, false),
                    plural(s.recoveryCodesLeft, 'recovery code'),
                  )
                : t(
                    'Protect the account with a code from an authenticator app, so a stolen password is not enough.',
                  )}
            </p>
          </div>
        </div>
        {s &&
          (s.enabled ? (
            <div className="row-wrap">
              <button className="btn sm" onClick={() => setDialog('codes')}>
                {t('New recovery codes')}
              </button>
              <button className="btn sm danger" onClick={() => setDialog('disable')}>
                {t('Turn off')}
              </button>
            </div>
          ) : (
            <button className="btn primary sm" onClick={() => setDialog('enable')}>
              {t('Turn on')}
            </button>
          ))}
      </div>
      <ErrorAlert error={status.error} />
      {dialog === 'enable' && <EnableTwoFactor onClose={close} />}
      {dialog === 'codes' && (
        <Modal title={t('New recovery codes')} onClose={close}>
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
                {t('Your old recovery codes stop working. Confirm with a code from the app.')}
              </p>
              <Field label={t('Authentication or recovery code')}>
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
                {t('Create new codes')}
              </button>
            </form>
          )}
        </Modal>
      )}
      {dialog === 'disable' && (
        <Modal title={t('Turn off two-step verification')} onClose={close}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate();
            }}
          >
            <p className="small muted">{t('Your account will be protected by the password only.')}</p>
            <Field label={t('Password')}>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </Field>
            <Field label={t('Authentication or recovery code')}>
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
              {t('Turn off')}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const DOCUMENT_LABELS: Record<(typeof IDENTITY_DOCUMENTS)[number], string> = {
  passport: 'Passport',
  id_card: msg('National ID card'),
  driver_license: msg('Driving licence'),
  residence_permit: msg('Residence permit'),
};

function IdentitySection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const check = useQuery({ queryKey: ['identity'], queryFn: api.me.identity });
  const [form, setForm] = useState({
    legalName: '',
    dateOfBirth: '',
    country: '',
    documentType: 'passport' as (typeof IDENTITY_DOCUMENTS)[number],
    documentNumber: '',
  });
  const [document, setDocument] = useState<FileInfo[]>([]);
  const [selfie, setSelfie] = useState<FileInfo[]>([]);
  const submit = useMutation({
    mutationFn: () =>
      api.me.submitIdentity({ ...form, documentFileId: document[0]!.id, selfieFileId: selfie[0]?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['identity'] });
      void reload();
      toast.success(t('Sent — staff check it by hand, usually within a day'));
    },
  });
  const c = check.data;
  const canSend = !c || c.status === 'rejected' || c.status === 'revoked';
  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="kpi-icon" style={{ width: 42, height: 42 }}>
            <Icon name="shield" size={19} />
          </span>
          <div className="grow">
            <h3>{t('Identity verification')}</h3>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              {t(
                'Company owners pass a one-time identity check before their company is approved; their companies then show the “Verified business” badge. Staff compare your details with a photo of your document. Only the last four characters of the document number are kept.',
              )}
            </p>
          </div>
          {c && <StatusBadge status={c.status === 'approved' ? 'verified' : c.status} />}
        </div>
        {check.isLoading && <SkeletonList rows={2} avatar={false} />}
        {c?.status === 'pending' && (
          <div className="alert info small">
            <Icon name="clock" size={16} />
            <span>
              {t(
                'Sent {0} — {1} ending in {2}. You get an email when it is checked.',
                timeAgo(c.createdAt),
                t(DOCUMENT_LABELS[c.documentType]),
                c.documentLast4,
              )}
            </span>
          </div>
        )}
        {c?.status === 'approved' && (
          <div className="alert success small">
            <Icon name="check" size={16} />
            <span>
              {t('Verified {0} as', c.reviewedAt ? formatDate(c.reviewedAt, false) : '')} <b>{c.legalName}</b>
              .
            </span>
          </div>
        )}
        {(c?.status === 'rejected' || c?.status === 'revoked') && (
          <div className="alert error small">
            <Icon name="info" size={16} />
            <span>
              {c.status === 'rejected' ? t('Not accepted') : t('Verification removed')}: {c.rejectionReason}
              {t('. You can send a new check below.')}
            </span>
          </div>
        )}
      </div>
      {canSend && !check.isLoading && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <h3>{t('Send your details')}</h3>
          <div className="grid-2">
            <Field label={t('Full legal name')} hint={t('As written in the document.')}>
              <input
                className="input"
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                required
                maxLength={120}
              />
            </Field>
            <Field label={t('Date of birth')}>
              <input
                className="input"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                required
              />
            </Field>
            <Field label={t('Country or virtual country')}>
              <input
                className="input"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                required
                maxLength={80}
              />
            </Field>
            <Field label={t('Document')}>
              <select
                className="select"
                value={form.documentType}
                onChange={(e) =>
                  setForm({ ...form, documentType: e.target.value as (typeof IDENTITY_DOCUMENTS)[number] })
                }
              >
                {IDENTITY_DOCUMENTS.map((d) => (
                  <option key={d} value={d}>
                    {t(DOCUMENT_LABELS[d])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Document number')}>
              <input
                className="input"
                value={form.documentNumber}
                onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                required
                minLength={4}
                maxLength={40}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label={t('Photo or scan of the document')}>
            <AttachmentPicker
              value={document}
              onChange={setDocument}
              upload={(file) => api.files.upload(file, file.name)}
              remove={(file) => api.files.remove(file.id)}
              href={api.files.url}
              max={1}
              accept="image/*,.pdf"
              label={t('Add the document')}
            />
          </Field>
          <Field label={t('A photo of you holding it (optional, speeds up the check)')}>
            <AttachmentPicker
              value={selfie}
              onChange={setSelfie}
              upload={(file) => api.files.upload(file, file.name)}
              remove={(file) => api.files.remove(file.id)}
              href={api.files.url}
              max={1}
              accept="image/*"
              label={t('Add a photo')}
            />
          </Field>
          <ErrorAlert error={submit.error} />
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={submit.isPending || !document.length}
          >
            {t('Send for checking')}
          </button>
        </form>
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
      toast.success(t('Password changed — your other devices were signed out'));
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
        <h3>{t('Change password')}</h3>
        <Field label={t('Current password')}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
            required
          />
        </Field>
        <Field
          label={t('New password')}
          hint={t('Every other device is signed out; this one stays signed in.')}
        >
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
          {t('Change password')}
        </button>
      </form>
      <TwoFactorCard />
      <PasskeysCard />
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
      <h3>{t('Developer API keys')}</h3>
      <p className="small muted">
        {t('Let your own services search the public registry and read stock data. Send the key as the')}{' '}
        <code>{t('X-API-Key')}</code> {t('header, e.g.')}{' '}
        <code>{t('GET {0}/api/v1/registry?q=…', base)}</code> {t('— full reference in the')}{' '}
        <a href={`${base}/api/docs`} target="_blank" rel="noreferrer">
          {t('API docs')}
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
              <b>{t('Copy your new key now — it is shown only once:')}</b>
              <code style={{ wordBreak: 'break-all' }}>{create.data.key}</code>
            </div>
            <button
              className="btn sm"
              onClick={() =>
                navigator.clipboard?.writeText(create.data!.key).then(() => toast.success(t('Key copied')))
              }
            >
              <Icon name="copy" size={14} /> {t('Copy')}
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
          placeholder={t('Key name, e.g. My website')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn primary">{t('Create key')}</button>
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
                <code>{k.prefix}…</code> {t('· created')} {formatDate(k.createdAt, false)}
                {k.lastUsedAt && ` ${t('· last used {0}', formatDate(k.lastUsedAt))}`}
              </div>
            </div>
            {k.revokedAt ? (
              <span className="badge bad">{t('Revoked')}</span>
            ) : (
              <button className="btn sm ghost" onClick={() => revoke.mutate(k.id)}>
                {t('Revoke')}
              </button>
            )}
          </div>
        ))}
      </div>
      {keys.data?.length === 0 && <Empty icon="key" title={t('No keys yet')} />}
    </div>
  );
}

const EVENT_LABELS: Record<(typeof WEBHOOK_EVENTS)[number], string> = {
  'registry.created': msg('New registry entries'),
  'registry.updated': msg('Registry changes (status, renewal, expiry)'),
  'listing.created': msg('New stock listings'),
  'listing.updated': msg('Listing changes (price, status)'),
};

/** Push registry and stock changes to your own service. */
function WebhooksCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: api.webhooks.list });
  const [form, setForm] = useState({
    url: '',
    description: '',
    events: ['registry.created', 'registry.updated'] as string[],
  });
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () =>
      api.webhooks.create({
        url: form.url,
        description: form.description || undefined,
        events: form.events as WebhookEndpoint['events'],
      }),
    onSuccess: (w) => {
      setSecret(w.secret);
      setForm({ ...form, url: '', description: '' });
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: async ({
      w,
      action,
    }: {
      w: WebhookEndpoint;
      action: 'test' | 'toggle' | 'rotate' | 'delete';
    }) => {
      if (action === 'test') {
        const d = await api.webhooks.test(w.id);
        if (d.status === 'delivered') toast.success(t('Ping delivered (HTTP {0})', d.responseStatus ?? ''));
        else toast.error(new Error(t('Ping failed: {0}', d.error ?? t('no answer'))));
      } else if (action === 'toggle') await api.webhooks.update(w.id, { active: !w.active });
      else if (action === 'rotate') setSecret((await api.webhooks.rotateSecret(w.id)).secret);
      else await api.webhooks.remove(w.id);
    },
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['webhookDeliveries'] });
    },
  });
  const deliveries = useQuery({
    queryKey: ['webhookDeliveries', open],
    queryFn: () => api.webhooks.deliveries(open!),
    enabled: !!open,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.webhooks.redeliver(open!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhookDeliveries'] }),
  });
  return (
    <div className="card stack">
      <h3>{t('Webhooks')}</h3>
      <p className="small muted">
        {t('We POST a JSON event to your URL when the registry or the stock exchange changes. Check the')}{' '}
        <code>{t('X-OVL-Signature')}</code> {t('header with your secret (the SDK has')}{' '}
        <code>{t('verifyWebhookSignature')}</code>
        {t('); failed deliveries are retried for about 15 hours.')}
      </p>
      <AnimatePresence>
        {secret && (
          <motion.div
            className="alert success stack-sm"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="grow stack-sm">
              <b>{t('Copy the signing secret now — it is shown only once:')}</b>
              <code style={{ wordBreak: 'break-all' }}>{secret}</code>
            </div>
            <button
              className="btn sm"
              onClick={() =>
                navigator.clipboard?.writeText(secret).then(() => toast.success(t('Secret copied')))
              }
            >
              <Icon name="copy" size={14} /> {t('Copy')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="row-wrap">
          <input
            className="input"
            style={{ flex: '2 1 280px' }}
            type="url"
            placeholder={t('https://example.com/ovl-webhook')}
            aria-label={t('Webhook URL')}
            value={form.url}
            required
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          <input
            className="input"
            style={{ flex: '1 1 180px' }}
            placeholder={t('Description (optional)')}
            aria-label={t('Webhook description')}
            value={form.description}
            maxLength={200}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="row-wrap">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="row small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={form.events.includes(ev)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev),
                  })
                }
              />
              {t(EVENT_LABELS[ev])}
            </label>
          ))}
        </div>
        <div>
          <button className="btn primary" disabled={create.isPending || !form.events.length}>
            {t('Add webhook')}
          </button>
        </div>
      </form>
      <ErrorAlert error={create.error ?? act.error ?? redeliver.error} />
      <div className="list">
        {hooks.data?.map((w) => (
          <div key={w.id} className="stack-sm">
            <div className="list-item" style={{ cursor: 'default' }}>
              <span className="kpi-icon">
                <Icon name="zap" size={16} />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold ellipsis">{w.description || w.url}</div>
                <div className="small muted ellipsis">
                  {w.description && `${w.url} · `}
                  {plural(w.events.length, 'event')}
                  {w.lastDeliveryAt && ` ${t('· last delivery {0}', formatDate(w.lastDeliveryAt))}`}
                  {w.failures > 0 && ` ${t('· {0} failed in a row', w.failures)}`}
                </div>
                {w.disabledReason && <div className="small neg">{w.disabledReason}</div>}
              </div>
              <span className={`badge ${w.active ? 'ok' : ''}`}>{w.active ? t('Active') : t('Off')}</span>
              <div className="row" style={{ gap: 4 }}>
                <button
                  className="btn sm ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ w, action: 'test' })}
                >
                  {t('Test')}
                </button>
                <button className="btn sm ghost" onClick={() => setOpen(open === w.id ? null : w.id)}>
                  {t('Log')}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ w, action: 'toggle' })}
                >
                  {w.active ? t('Turn off') : t('Turn on')}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ w, action: 'rotate' })}
                >
                  {t('New secret')}
                </button>
                <button
                  className="btn sm ghost"
                  aria-label={t('Delete webhook {0}', w.url)}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ w, action: 'delete' })}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            {open === w.id && (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {deliveries.data?.map((d) => (
                      <tr key={d.id}>
                        <td className="small nowrap">{formatDate(d.createdAt)}</td>
                        <td>
                          <code className="small">{d.event}</code>
                        </td>
                        <td>
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="small muted">
                          {d.responseStatus ? t('HTTP {0}', d.responseStatus) : ''}{' '}
                          {d.error && d.error !== `HTTP ${d.responseStatus}` ? d.error : ''}
                          {d.nextAttemptAt &&
                            (d.attempts > 0
                              ? ` ${t('· retry {0}', formatDate(d.nextAttemptAt))}`
                              : t('Waiting to be sent'))}
                        </td>
                        <td className="right">
                          {d.status !== 'delivered' && (
                            <button
                              className="btn sm ghost"
                              disabled={redeliver.isPending}
                              onClick={() => redeliver.mutate(d.id)}
                            >
                              {t('Send again')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {deliveries.data?.length === 0 && (
                  <p className="small muted">{t('Nothing delivered yet.')}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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
        title={t('Settings')}
        subtitle={t('Your profile, appearance, accounts and developer access.')}
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Settings sections')}>
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
                <span>{t(s.label)}</span>
                <span className="tiny muted">{t(s.hint)}</span>
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
            {section === 'identity' && <IdentitySection />}
            {section === 'developer' && (
              <div className="stack-lg">
                <DeveloperSection />
                <WebhooksCard />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
