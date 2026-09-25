import type { StoredAccount } from '../accounts';
import {
  AnimatedNumber,
  AreaChart,
  Avatar,
  Badges,
  ErrorAlert,
  Field,
  ForgotPasswordForm,
  formatMoney,
  Icon,
  Logo,
  needsTwoFactor,
  passkeyCancelled,
  passkeysSupported,
  Segmented,
  TwoFactorPrompt,
  t,
  LanguagePicker,
  msg,
} from '@ovl/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { apiUrl, customServer, setCustomServer } from '../config';

const ease = [0.22, 1, 0.36, 1] as const;

const FEATURES = [
  { icon: 'globe', text: msg('Business balances in 155 world currencies') },
  { icon: 'shield', text: msg('Licenses approved by moderation, council and the owner') },
  { icon: 'chart', text: 'A stock exchange that grows your business balance' },
  { icon: 'book', text: 'A public registry other services can query' },
] as const;

// ---------------------------------------------------------------------------
// Animated brand panel
// ---------------------------------------------------------------------------

function Floating({
  delay,
  children,
  className,
}: {
  delay: number;
  children: React.ReactNode;
  className: string;
}) {
  return (
    <motion.div
      className={`float-card ${className}`}
      initial={{ opacity: 0, y: 30, scale: 0.94 }}
      animate={{ opacity: 1, y: [0, -8, 0], scale: 1 }}
      transition={{
        opacity: { delay, duration: 0.6 },
        scale: { delay, duration: 0.6, ease },
        y: { delay: delay + 0.6, duration: 6, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {children}
    </motion.div>
  );
}

function ChatTicker() {
  const lines = [
    { who: t('Council'), text: t('License OVL-LIC-000128 approved'), tone: 'council' },
    { who: 'Maria', text: 'Q3 investor update is live 📈', tone: 'accent' },
    { who: t('Support'), text: t('Your deposit was credited'), tone: 'support' },
  ];
  const [count, setCount] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setCount((c) => (c >= lines.length ? 1 : c + 1)), 2200);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="stack-sm">
      <AnimatePresence initial={false}>
        {lines.slice(0, count).map((l) => (
          <motion.div
            key={l.text}
            layout
            className="ticker-line"
            initial={{ opacity: 0, x: -12, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className={`ticker-dot ${l.tone}`} />
            <b>{l.who}</b>
            <span className="ellipsis">{t(l.text)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function BrandPanel() {
  const [feature, setFeature] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFeature((f) => (f + 1) % FEATURES.length), 3200);
    return () => clearInterval(t);
  }, []);
  const current = FEATURES[feature]!;
  return (
    <div className="auth-brand" aria-hidden="true">
      <div className="mesh">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="grid-overlay" />
      <motion.div
        className="brand-top"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
      >
        <Logo size={40} animated />
        <div>
          <div className="brand-name">{t('OVL For Business')}</div>
          <div className="brand-sub">{t('Corporate platform')}</div>
        </div>
      </motion.div>

      <div className="brand-stage">
        <Floating delay={0.3} className="fc-balance">
          <div className="fc-label">
            <Icon name="wallet" size={15} /> {t('Business balance')}
          </div>
          <div className="fc-amount">
            <AnimatedNumber value="128420.50" duration={2200} format={(v) => formatMoney(v, 'EUR')} />
          </div>
          <div className="fc-meta">
            <span className="up">▲ 12.4%</span> {t('this quarter ·')} <Icon name="lock" size={12} />{' '}
            {t('30% frozen')}
          </div>
        </Floating>
        <Floating delay={0.55} className="fc-stock">
          <div className="spread">
            <div>
              <div className="fc-label">{t('AURA · Aurora Media')}</div>
              <div className="fc-price">{t('12.50 EUR')}</div>
            </div>
            <span className="fc-pill">+4.2%</span>
          </div>
          <AreaChart
            values={[8, 9.1, 8.7, 9.8, 10.4, 10.1, 11.2, 11.8, 12.5]}
            height={64}
            color="#34D399"
            label={t('AURA')}
          />
        </Floating>
        <Floating delay={0.8} className="fc-chat">
          <div className="fc-label">
            <Icon name="chat" size={15} /> {t('Live activity')}
          </div>
          <ChatTicker />
        </Floating>
        <Floating delay={1.05} className="fc-stamp">
          <motion.div
            className="stamp"
            initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{ delay: 1.6, type: 'spring', stiffness: 260, damping: 14 }}
          >
            <Icon name="check" size={16} /> {t('Approved')}
          </motion.div>
          <div className="fc-label">{t('Registry')}</div>
          <div className="mono small">{t('OVL-ORG-000042')}</div>
        </Floating>
      </div>

      <div className="brand-bottom">
        <h2 className="brand-headline">
          {t('Run your company,')}
          <br />
          <span className="gradient-text-light">{t('money and licenses')}</span> {t('in one place.')}
        </h2>
        <div className="feature-rotator">
          <AnimatePresence mode="wait">
            <motion.div
              key={feature}
              className="row"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              <Icon name={current.icon} size={18} />
              {t(current.text)}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="feature-dots">
          {FEATURES.map((f, i) => (
            <span key={f.text} className={i === feature ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        required
        style={{ paddingRight: 44 }}
      />
      <button
        type="button"
        className="btn ghost icon sm"
        style={{ position: 'absolute', right: 5, top: 5 }}
        onClick={() => setVisible(!visible)}
        aria-label={t('Show characters')}
        aria-pressed={visible}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  );
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const { login, loginWithPasskey } = useAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [forgot, setForgot] = useState(false);
  const attempt = async (code?: string) => {
    setBusy(true);
    setError(null);
    try {
      await login({ ...form, code });
      onDone();
    } catch (err) {
      if (needsTwoFactor(err)) setNeedCode(true);
      setError(err);
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void attempt();
  };
  if (forgot) {
    return (
      <ForgotPasswordForm
        initialEmail={form.login}
        onSubmit={(email) => api.auth.forgotPassword(email)}
        onBack={() => setForgot(false)}
      />
    );
  }
  if (needCode) {
    return (
      <TwoFactorPrompt
        busy={busy}
        error={error}
        onSubmit={(code) => void attempt(code)}
        onBack={() => {
          setNeedCode(false);
          setError(null);
        }}
      />
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <ErrorAlert error={error} />
      <Field label={t('Username or email')}>
        <div className="input-with-icon">
          <Icon name="user" size={17} />
          <input
            className="input"
            autoComplete="username"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
            autoFocus
          />
        </div>
      </Field>
      <Field label={t('Password')}>
        <PasswordInput
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          autoComplete="current-password"
        />
      </Field>
      <button type="button" className="link-button small" onClick={() => setForgot(true)}>
        {t('Forgot password?')}
      </button>
      <button className="btn gradient lg block" disabled={busy}>
        {busy ? <span className="spinner light" /> : <>{t('Sign in')}</>}
        {!busy && <Icon name="arrowRight" size={18} />}
      </button>
      {passkeysSupported() && (
        <button
          type="button"
          className="btn lg block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await loginWithPasskey();
              onDone();
            } catch (err) {
              if (!passkeyCancelled(err)) setError(err);
              setBusy(false);
            }
          }}
        >
          <Icon name="key" size={17} /> {t('Sign in with a passkey')}
        </button>
      )}
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const { register } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const strength = Math.min(
    4,
    [/.{8,}/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(form.password)).length,
  );
  return (
    <form className="stack" onSubmit={submit}>
      <ErrorAlert error={error} />
      <Field label={t('Display name')}>
        <input
          className="input"
          value={form.displayName}
          onChange={set('displayName')}
          required
          maxLength={64}
          autoFocus
        />
      </Field>
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label={t('Username')}>
          <input
            className="input"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
            required
            pattern="[A-Za-z][A-Za-z0-9_]{2,31}"
            title={t('3–32 characters: letters, digits and underscore')}
          />
        </Field>
        <Field label={t('Email')}>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
      </div>
      <Field label={t('Password')} hint={t('At least 8 characters.')}>
        <PasswordInput
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          autoComplete="new-password"
          minLength={8}
        />
      </Field>
      <div className="strength" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            animate={{ opacity: i < strength ? 1 : 0.25, scaleX: i < strength ? 1 : 0.9 }}
            className={`s${strength}`}
          />
        ))}
      </div>
      <button className="btn gradient lg block" disabled={busy}>
        {busy ? <span className="spinner light" /> : <>{t('Create account')}</>}
        {!busy && <Icon name="arrowRight" size={18} />}
      </button>
      <p className="tiny muted">
        {t(
          'This creates your personal account. Companies, licenses and staff roles are requested from inside the app.',
        )}
      </p>
    </form>
  );
}

function SavedAccounts({
  list,
  onPick,
  onOther,
}: {
  list: StoredAccount[];
  onPick: (a: StoredAccount) => void;
  onOther: () => void;
}) {
  return (
    <div className="stack">
      <div className="list card pad-0">
        {list.map((a, i) => (
          <motion.button
            key={a.id}
            className="list-item"
            onClick={() => onPick(a)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Avatar name={a.displayName} url={a.avatarUrl} size={40} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="bold">{a.displayName}</span>
                <Badges badges={a.badges} />
              </div>
              <div className="small muted">@{a.username}</div>
            </div>
            <Icon name="chevronRight" size={18} />
          </motion.button>
        ))}
      </div>
      <button className="btn block" onClick={onOther}>
        <Icon name="userPlus" size={17} /> {t('Use another account')}
      </button>
    </div>
  );
}

function ServerSettings() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(customServer() ?? '');
  if (!open) {
    return (
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        <Icon name="globe" size={14} /> {apiUrl() || location.host}
      </button>
    );
  }
  return (
    <div className="stack-sm" style={{ width: '100%' }}>
      <Field
        label={t('Server address')}
        hint={t('For self-hosted deployments. Leave empty for this website.')}
      >
        <input
          className="input"
          placeholder={t('https://business.example.com')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          setCustomServer(value.trim() || null);
          location.reload();
        }}
      >
        {t('Save and reload')}
      </button>
    </div>
  );
}

type Mode = 'signin' | 'register';

export function LoginPage({ initialMode = 'signin' }: { initialMode?: Mode }) {
  const { accounts, switchAccount, addingAccount, cancelAddAccount, me } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [choosing, setChoosing] = useState(!addingAccount && accounts.length > 0 && !me);
  const [done, setDone] = useState(false);

  const title = done
    ? t('You are in')
    : choosing
      ? t('Choose an account')
      : addingAccount
        ? t('Add another account')
        : mode === 'signin'
          ? t('Welcome back')
          : t('Create your account');
  const subtitle = choosing
    ? t('Accounts signed in on this device.')
    : mode === 'signin'
      ? t('Sign in to continue to your workspace.')
      : t('Start with a personal account — it takes a minute.');

  return (
    <div className="auth-shell">
      <BrandPanel />
      <div className="auth-panel">
        <motion.div
          className="auth-card"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.1 }}
        >
          <div className="auth-mobile-logo">
            <Logo size={44} animated />
          </div>
          {addingAccount && (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={cancelAddAccount}>
              <Icon name="back" size={16} /> {t('Back to {0}', me?.displayName ?? 'the app')}
            </button>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <h1 className="auth-title">{title}</h1>
              {!done && <p className="muted">{subtitle}</p>}
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                className="auth-done"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <motion.span
                  className="done-ring"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                >
                  <Icon name="check" size={34} />
                </motion.span>
              </motion.div>
            ) : choosing ? (
              <motion.div
                key="choose"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <SavedAccounts
                  list={accounts}
                  onPick={(a) => switchAccount(a.id)}
                  onOther={() => setChoosing(false)}
                />
              </motion.div>
            ) : (
              <motion.div
                key="forms"
                className="stack-lg"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="row">
                  <div className="grow">
                    <Segmented<Mode>
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: 'signin', label: t('Sign in') },
                        { value: 'register', label: t('Create account') },
                      ]}
                    />
                  </div>
                  <LanguagePicker compact />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={mode}
                    initial={{ opacity: 0, x: mode === 'signin' ? -16 : 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: mode === 'signin' ? 16 : -16 }}
                    transition={{ duration: 0.25, ease }}
                  >
                    {mode === 'signin' ? (
                      <SignInForm onDone={() => setDone(true)} />
                    ) : (
                      <RegisterForm onDone={() => setDone(true)} />
                    )}
                  </motion.div>
                </AnimatePresence>
                {accounts.length > 0 && !addingAccount && !me && (
                  <button className="btn ghost sm" onClick={() => setChoosing(true)}>
                    <Icon name="users" size={15} /> {t('Saved accounts ({0})', accounts.length)}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="auth-footer">
            <ServerSettings />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  return <LoginPage initialMode="register" />;
}
