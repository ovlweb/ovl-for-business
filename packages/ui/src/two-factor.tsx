import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { ErrorAlert, Field } from './components';
import { Icon } from './icons';

/** True for the server's "this account needs a second factor" answer. */
export function needsTwoFactor(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'two_factor_required';
}

/**
 * The second step of signing in: a code from the authenticator app, or a recovery code.
 * Used by the web client and the admin panel.
 */
export function TwoFactorPrompt({
  onSubmit,
  onBack,
  busy,
  error,
}: {
  onSubmit: (code: string) => void;
  onBack: () => void;
  busy: boolean;
  error: unknown;
}) {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(code.trim());
  };
  return (
    <motion.form
      className="stack"
      onSubmit={submit}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="kpi-icon" style={{ width: 42, height: 42 }}>
          <Icon name="shield" size={20} />
        </span>
        <div>
          <b>Two-step verification</b>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {recovery
              ? 'Enter one of the recovery codes you saved when you turned this on. Each code works once.'
              : 'Open your authenticator app and enter the 6-digit code for OVL For Business.'}
          </p>
        </div>
      </div>
      <ErrorAlert error={needsTwoFactor(error) ? null : error} />
      <Field label={recovery ? 'Recovery code' : 'Authentication code'}>
        <input
          key={recovery ? 'recovery' : 'totp'}
          className="input code-input"
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={recovery ? 'xxxxx-xxxxx' : '123 456'}
          maxLength={recovery ? 20 : 6}
          autoFocus
          required
        />
      </Field>
      <button className="btn gradient lg block" disabled={busy || (!recovery && code.length !== 6)}>
        {busy ? <span className="spinner light" /> : <>Verify</>}
        {!busy && <Icon name="check" size={18} />}
      </button>
      <div className="spread">
        <button type="button" className="btn ghost sm" onClick={onBack}>
          <Icon name="back" size={15} /> Back
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
          }}
        >
          {recovery ? 'Use the authenticator app' : 'Use a recovery code'}
        </button>
      </div>
    </motion.form>
  );
}
