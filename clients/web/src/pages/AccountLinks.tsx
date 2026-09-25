import { ErrorAlert, Icon, Logo, ResetPasswordForm, Spinner, t } from '@ovl/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/** Pages opened from emails: confirm the address, or choose a new password. */
export function AccountLinkPage({ kind }: { kind: 'verify-email' | 'reset-password' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  return (
    <div className="link-shell">
      <motion.div
        className="card link-card stack-lg"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <Logo size={44} animated />
        {kind === 'verify-email' ? <VerifyEmail token={token} /> : <ResetPassword token={token} />}
      </motion.div>
    </div>
  );
}

function Done({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="stack">
      <span className="done-ring small">
        <Icon name="check" size={26} />
      </span>
      <h1 className="auth-title">{title}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {text}
      </p>
      {action}
    </div>
  );
}

function VerifyEmail({ token }: { token: string }) {
  const navigate = useNavigate();
  const { me, reload } = useAuth();
  const [state, setState] = useState<{ email?: string; error?: unknown }>({});
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.auth.verifyEmail(token).then(
      (r) => {
        setState({ email: r.email });
        if (me) void reload();
      },
      (error) => setState({ error }),
    );
  }, [token, me, reload]);
  if (state.error)
    return (
      <div className="stack">
        <h1 className="auth-title">{t('This link did not work')}</h1>
        <ErrorAlert error={state.error} />
        <button className="btn" onClick={() => navigate('/settings?section=profile')}>
          {t('Send a new link from Settings')}
        </button>
      </div>
    );
  if (!state.email) return <Spinner center />;
  return (
    <Done
      title={t('Email confirmed')}
      text={`${state.email} is confirmed. You can now apply for companies and licenses.`}
      action={
        <button className="btn gradient lg block" onClick={() => navigate('/home')}>
          {t('Continue')} <Icon name="arrowRight" size={18} />
        </button>
      }
    />
  );
}

function ResetPassword({ token }: { token: string }) {
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const [done, setDone] = useState(false);
  if (done)
    return (
      <Done
        title={t('Password changed')}
        text={t('Every device was signed out. Sign in with your new password.')}
        action={
          <button className="btn gradient lg block" onClick={() => navigate('/')}>
            {t('Sign in')} <Icon name="arrowRight" size={18} />
          </button>
        }
      />
    );
  return (
    <div className="stack">
      <h1 className="auth-title">{t('Choose a new password')}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {t('After this, every device signed in to the account is signed out.')}
      </p>
      <ResetPasswordForm
        onSubmit={async (password) => {
          await api.auth.resetPassword(token, password);
          if (me) await logout().catch(() => undefined);
          setDone(true);
        }}
      />
    </div>
  );
}
