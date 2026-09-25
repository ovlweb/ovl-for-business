import {
  ErrorAlert,
  Field,
  ForgotPasswordForm,
  Icon,
  Logo,
  needsTwoFactor,
  passkeyCancelled,
  passkeysSupported,
  TwoFactorPrompt,
  type IconName,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { api } from '../api';
import { useAdminAuth } from '../auth';

const ease = [0.22, 1, 0.36, 1] as const;

const DUTIES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'review', title: 'Review queue', text: 'Moderation checklists, council votes and owner sign-off.' },
  { icon: 'wallet', title: 'Cash desk', text: 'Deposits and withdrawals in any currency, fully journaled.' },
  { icon: 'book', title: 'Public registry', text: 'Suspend or revoke licenses and organizations.' },
  { icon: 'shield', title: 'Audit trail', text: 'Every privileged action, who did it and from where.' },
];

export function LoginPage() {
  const { login, loginWithPasskey, ssoError } = useAdminAuth();
  const sso = useQuery({ queryKey: ['sso'], queryFn: api.auth.sso, staleTime: Infinity, retry: false });
  const [form, setForm] = useState({ login: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [forgot, setForgot] = useState(false);
  const attempt = async (code?: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(form.login, form.password, code);
    } catch (err) {
      if (needsTwoFactor(err)) setNeedCode(true);
      setError(err);
      setBusy(false);
    }
  };
  return (
    <div className="admin-login">
      <div className="admin-login-art" aria-hidden>
        <div className="admin-grid" />
        <motion.div
          className="admin-orb"
          animate={{ scale: [1, 1.12, 1], opacity: [0.55, 0.8, 0.55] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="admin-login-copy">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            <span className="admin-chip">
              <Icon name="lock" size={13} /> Restricted area
            </span>
            <h1>The control room of OVL For Business.</h1>
            <p>Approvals, money, the registry and support — everything staff need, in one console.</p>
          </motion.div>
          <div className="admin-duties">
            {DUTIES.map((d, i) => (
              <motion.div
                key={d.title}
                className="admin-duty"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.1, duration: 0.5, ease }}
              >
                <span className="admin-duty-icon">
                  <Icon name={d.icon} size={18} />
                </span>
                <div>
                  <b>{d.title}</b>
                  <span>{d.text}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
      <div className="admin-login-panel">
        {forgot ? (
          <div className="admin-login-card stack-lg">
            <Logo size={48} />
            <ForgotPasswordForm
              initialEmail={form.login}
              onSubmit={(email) => api.auth.forgotPassword(email)}
              onBack={() => setForgot(false)}
            />
          </div>
        ) : needCode ? (
          <div className="admin-login-card stack-lg">
            <Logo size={48} />
            <TwoFactorPrompt
              busy={busy}
              error={error}
              onSubmit={(code) => void attempt(code)}
              onBack={() => {
                setNeedCode(false);
                setError(null);
              }}
            />
          </div>
        ) : (
          <motion.form
            className="admin-login-card stack-lg"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease, delay: 0.1 }}
            onSubmit={(e) => {
              e.preventDefault();
              void attempt();
            }}
          >
            <div className="stack-sm">
              <Logo size={48} animated />
              <h2 style={{ marginTop: 10 }}>Admin console</h2>
              <p className="small muted">Staff only: moderators, finance managers, admins and the owner.</p>
            </div>
            <ErrorAlert error={error ?? ssoError} />
            {sso.data?.enabled && (
              <>
                <button
                  type="button"
                  className="btn gradient lg block"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      window.location.assign((await api.auth.ssoStart()).url);
                    } catch (err) {
                      setError(err);
                      setBusy(false);
                    }
                  }}
                >
                  <Icon name="shield" size={17} /> {sso.data.label}
                </button>
                <div className="or-divider small muted">or with a password</div>
              </>
            )}
            <Field label="Username or email">
              <div className="input-with-icon">
                <Icon name="user" size={17} />
                <input
                  className="input"
                  autoComplete="username"
                  value={form.login}
                  onChange={(e) => setForm({ ...form, login: e.target.value })}
                  required
                />
              </div>
            </Field>
            <Field label="Password">
              <div className="input-with-icon">
                <Icon name="key" size={17} />
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShow(!show)}
                  aria-label="Show characters"
                  aria-pressed={show}
                >
                  <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
                </button>
              </div>
            </Field>
            <button type="button" className="link-button small" onClick={() => setForgot(true)}>
              Forgot password?
            </button>
            <button className="btn gradient lg block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
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
                  } catch (err) {
                    if (!passkeyCancelled(err)) setError(err);
                    setBusy(false);
                  }
                }}
              >
                <Icon name="key" size={17} /> Sign in with a passkey
              </button>
            )}
            <p className="tiny muted center-text">
              Sessions end when this tab closes. Every action is audited.
            </p>
          </motion.form>
        )}
      </div>
    </div>
  );
}
