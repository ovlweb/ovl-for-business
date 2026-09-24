import { motion } from 'motion/react';
import { useState } from 'react';
import { ErrorAlert, Field } from './components';
import { Icon } from './icons';

const enter = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

/** "Forgot password?": ask for a reset link. Used by the web client and the admin panel. */
export function ForgotPasswordForm({
  onSubmit,
  onBack,
  initialEmail = '',
}: {
  onSubmit: (email: string) => Promise<unknown>;
  onBack: () => void;
  initialEmail?: string;
}) {
  const [email, setEmail] = useState(initialEmail.includes('@') ? initialEmail : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <motion.div className="stack" {...enter}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="kpi-icon" style={{ width: 42, height: 42 }}>
            <Icon name="send" size={19} />
          </span>
          <div>
            <b>Check your inbox</b>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              If an account uses {email}, we sent it a link to choose a new password. The link works for one
              hour.
            </p>
          </div>
        </div>
        <button type="button" className="btn block" onClick={onBack}>
          <Icon name="back" size={16} /> Back to sign in
        </button>
      </motion.div>
    );
  }
  return (
    <motion.form
      className="stack"
      {...enter}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(email.trim());
          setSent(true);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="small muted" style={{ margin: 0 }}>
        Enter the email address of your account and we will send you a link to choose a new password.
      </p>
      <ErrorAlert error={error} />
      <Field label="Email">
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
      </Field>
      <button className="btn gradient lg block" disabled={busy}>
        {busy ? <span className="spinner light" /> : 'Send reset link'}
      </button>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        <Icon name="back" size={15} /> Back
      </button>
    </motion.form>
  );
}

/** Choose a new password from an emailed reset link. */
export function ResetPasswordForm({ onSubmit }: { onSubmit: (password: string) => Promise<unknown> }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mismatch = repeat.length > 0 && repeat !== password;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(password);
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}
    >
      <ErrorAlert error={error} />
      <Field label="New password" hint="At least 8 characters.">
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
      </Field>
      <Field label="Repeat the new password" error={mismatch ? 'The passwords do not match' : undefined}>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          required
        />
      </Field>
      <button className="btn gradient lg block" disabled={busy || mismatch || password.length < 8}>
        {busy ? <span className="spinner light" /> : 'Set new password'}
      </button>
    </form>
  );
}
