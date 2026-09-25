import { getTheme, IDENTITY_DOCUMENTS, ROLE_LABELS, type FileInfo, type Session } from '@ovl/shared';
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

type Section =
  'profile' | 'appearance' | 'notifications' | 'accounts' | 'security' | 'identity' | 'developer';

const SECTIONS: { id: Section; label: string; icon: IconName; hint: string }[] = [
  { id: 'profile', label: 'Profile', icon: 'user', hint: 'Name, bio and avatar' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', hint: 'Themes' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', hint: 'Background alerts' },
  { id: 'accounts', label: 'Accounts', icon: 'users', hint: 'Switch or add accounts' },
  { id: 'security', label: 'Security', icon: 'lock', hint: 'Password and sessions' },
  { id: 'identity', label: 'Identity', icon: 'shield', hint: 'Verification for company owners' },
  { id: 'developer', label: 'Developer', icon: 'key', hint: 'API keys' },
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
    onSuccess: () => toast.success(`Link sent to ${me.email}`),
  });
  const change = useMutation({
    mutationFn: () => api.me.changeEmail(form.email, form.password),
    onSuccess: async (updated) => {
      await reload();
      setChanging(false);
      setForm({ email: '', password: '' });
      toast.success(`Check ${updated.email} for a confirmation link`);
    },
  });
  return (
    <div className="card stack">
      <div className="spread">
        <div>
          <h3>Email</h3>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span>{me.email}</span>
            <StatusBadge status={me.emailVerified ? 'confirmed' : 'not_confirmed'} />
          </div>
        </div>
        {!changing && (
          <button className="btn" onClick={() => setChanging(true)}>
            Change email
          </button>
        )}
      </div>
      {!me.emailVerified && !changing && (
        <div className="alert warning small">
          <Icon name="info" size={16} />
          <span className="grow">
            Confirm your address with the link we emailed you. Applications for companies and licenses need a
            confirmed email.
          </span>
          <button className="btn sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
            Send the link again
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
            <Field label="New email">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoFocus
                required
              />
            </Field>
            <Field label="Your password">
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
              Change and send a confirmation link
            </button>
            <button type="button" className="btn ghost" onClick={() => setChanging(false)}>
              Cancel
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

function EnableTwoFactor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const [enabled, setEnabled] = useState(false);
  return (
    <Modal title={enabled ? 'Save your recovery codes' : 'Turn on two-step verification'} onClose={onClose}>
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
      toast.success(`Passkey "${key.name}" added`);
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
          <h3>Passkeys</h3>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            Sign in with your fingerprint, face or device PIN instead of a password. Passkeys cannot be
            phished and are stored by your device or password manager.
          </p>
        </div>
      </div>
      {keys.data?.map((k) => (
        <div key={k.id} className="spread passkey-row">
          <div>
            <b>{k.name}</b>
            <div className="small muted">
              Added {formatDate(k.createdAt, false)}
              {k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : ' · not used yet'}
              {k.backedUp ? ' · synced' : ''}
            </div>
          </div>
          <button
            className="btn ghost sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate(k.id)}
            aria-label={`Remove ${k.name}`}
          >
            <Icon name="trash" size={15} /> Remove
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
            aria-label="Passkey name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" disabled={add.isPending}>
            <Icon name="plus" size={16} /> Add a passkey
          </button>
        </form>
      ) : (
        <p className="small muted">This browser does not support passkeys.</p>
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

const DOCUMENT_LABELS: Record<(typeof IDENTITY_DOCUMENTS)[number], string> = {
  passport: 'Passport',
  id_card: 'National ID card',
  driver_license: 'Driving licence',
  residence_permit: 'Residence permit',
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
      toast.success('Sent — staff check it by hand, usually within a day');
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
            <h3>Identity verification</h3>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              Company owners pass a one-time identity check before their company is approved; their companies
              then show the “Verified business” badge. Staff compare your details with a photo of your
              document. Only the last four characters of the document number are kept.
            </p>
          </div>
          {c && <StatusBadge status={c.status === 'approved' ? 'verified' : c.status} />}
        </div>
        {check.isLoading && <SkeletonList rows={2} avatar={false} />}
        {c?.status === 'pending' && (
          <div className="alert info small">
            <Icon name="clock" size={16} />
            <span>
              Sent {timeAgo(c.createdAt)} — {DOCUMENT_LABELS[c.documentType]} ending in {c.documentLast4}. You
              get an email when it is checked.
            </span>
          </div>
        )}
        {c?.status === 'approved' && (
          <div className="alert success small">
            <Icon name="check" size={16} />
            <span>
              Verified {c.reviewedAt ? formatDate(c.reviewedAt, false) : ''} as <b>{c.legalName}</b>.
            </span>
          </div>
        )}
        {(c?.status === 'rejected' || c?.status === 'revoked') && (
          <div className="alert error small">
            <Icon name="info" size={16} />
            <span>
              {c.status === 'rejected' ? 'Not accepted' : 'Verification removed'}: {c.rejectionReason}. You
              can send a new check below.
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
          <h3>Send your details</h3>
          <div className="grid-2">
            <Field label="Full legal name" hint="As written in the document.">
              <input
                className="input"
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                required
                maxLength={120}
              />
            </Field>
            <Field label="Date of birth">
              <input
                className="input"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                required
              />
            </Field>
            <Field label="Country or virtual country">
              <input
                className="input"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Document">
              <select
                className="select"
                value={form.documentType}
                onChange={(e) =>
                  setForm({ ...form, documentType: e.target.value as (typeof IDENTITY_DOCUMENTS)[number] })
                }
              >
                {IDENTITY_DOCUMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DOCUMENT_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Document number">
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
          <Field label="Photo or scan of the document">
            <AttachmentPicker
              value={document}
              onChange={setDocument}
              upload={(file) => api.files.upload(file, file.name)}
              remove={(file) => api.files.remove(file.id)}
              href={api.files.url}
              max={1}
              accept="image/*,.pdf"
              label="Add the document"
            />
          </Field>
          <Field label="A photo of you holding it (optional, speeds up the check)">
            <AttachmentPicker
              value={selfie}
              onChange={setSelfie}
              upload={(file) => api.files.upload(file, file.name)}
              remove={(file) => api.files.remove(file.id)}
              href={api.files.url}
              max={1}
              accept="image/*"
              label="Add a photo"
            />
          </Field>
          <ErrorAlert error={submit.error} />
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={submit.isPending || !document.length}
          >
            Send for checking
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
            {section === 'identity' && <IdentitySection />}
            {section === 'developer' && <DeveloperSection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
