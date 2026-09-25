import type { TwoFactorSetup } from '@ovl/shared';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorAlert, Field } from './components';
import { Icon } from './icons';
import { useToast } from './toast';
import { t } from './i18n';

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
          <b>{t('Two-step verification')}</b>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {recovery
              ? t('Enter one of the recovery codes you saved when you turned this on. Each code works once.')
              : t('Open your authenticator app and enter the 6-digit code for OVL For Business.')}
          </p>
        </div>
      </div>
      <ErrorAlert error={needsTwoFactor(error) ? null : error} />
      <Field label={recovery ? t('Recovery code') : t('Authentication code')}>
        <input
          key={recovery ? 'recovery' : 'totp'}
          className="input code-input"
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={recovery ? t('xxxxx-xxxxx') : '123 456'}
          maxLength={recovery ? 20 : 6}
          autoFocus
          required
        />
      </Field>
      <button className="btn gradient lg block" disabled={busy || (!recovery && code.length !== 6)}>
        {busy ? <span className="spinner light" /> : <>{t('Verify')}</>}
        {!busy && <Icon name="check" size={18} />}
      </button>
      <div className="spread">
        <button type="button" className="btn ghost sm" onClick={onBack}>
          <Icon name="back" size={15} /> {t('Back')}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
          }}
        >
          {recovery ? t('Use the authenticator app') : t('Use a recovery code')}
        </button>
      </div>
    </motion.form>
  );
}

/** One-time recovery codes, shown once after turning two-step verification on. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const text = `OVL For Business recovery codes\n\n${codes.join('\n')}\n\nEach code signs in once.`;
  return (
    <div className="stack">
      <div className="alert warning small">
        <Icon name="info" size={17} />
        <span>
          {t(
            'Save these codes somewhere safe. Each one signs you in once if you lose your phone. They are shown only now.',
          )}
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
            navigator.clipboard?.writeText(text).then(() => toast.success(t('Recovery codes copied')))
          }
        >
          <Icon name="copy" size={16} /> {t('Copy')}
        </button>
        <a
          className="btn"
          download="ovl-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        >
          <Icon name="download" size={16} /> {t('Download')}
        </a>
        <button type="button" className="btn primary" onClick={onDone}>
          {t('I saved them')}
        </button>
      </div>
    </div>
  );
}

/**
 * Turn on two-step verification: scan the QR code, confirm a code, save the recovery codes.
 * Used in the web client's settings and by the admin panel's staff gate.
 */
export function TwoFactorSetupForm({
  load,
  enable,
  onDone,
  onEnabled,
}: {
  load: () => Promise<TwoFactorSetup>;
  enable: (code: string) => Promise<{ recoveryCodes: string[] }>;
  onDone: () => void;
  /** Called when it is on and the recovery codes are shown. */
  onEnabled?: () => void;
}) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // Every call makes a new secret (and replaces the previous one), so load exactly once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load().then(setSetup, setError);
  }, [load]);
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setCodes((await enable(code)).recoveryCodes);
          onEnabled?.();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ol className="steps small">
        <li>
          {t(
            'Install an authenticator app — Google Authenticator, 1Password, Authy, Microsoft Authenticator…',
          )}
        </li>
        <li>{t('Scan this QR code with it, or type the key.')}</li>
        <li>{t('Enter the 6-digit code the app shows.')}</li>
      </ol>
      <div className="qr-row">
        {setup ? (
          <img
            className="qr"
            src={setup.qr}
            alt={t('QR code for your authenticator app')}
            width={180}
            height={180}
          />
        ) : (
          <div className="qr skeleton" />
        )}
        <div className="stack-sm grow">
          <span className="small muted">{t('Key for manual entry')}</span>
          <code className="secret">{setup?.secret.match(/.{1,4}/g)?.join(' ') ?? '…'}</code>
        </div>
      </div>
      <Field label={t('Code from the app')}>
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
      <ErrorAlert error={error} />
      <button className="btn primary" disabled={code.length !== 6 || busy || !setup}>
        {busy ? <span className="spinner light" /> : t('Turn on')}
      </button>
    </form>
  );
}
