import { ErrorAlert, Field } from '@ovl/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { apiUrl, customServer, isNativeShell, setCustomServer } from '../config';

function ServerSettings() {
  const [open, setOpen] = useState(isNativeShell && !apiUrl());
  const [value, setValue] = useState(customServer() ?? '');
  if (!open) {
    return (
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        Server: {apiUrl() || 'this website'}
      </button>
    );
  }
  return (
    <div className="stack-sm">
      <Field label="Server address" hint="Leave empty to use the default server.">
        <input
          className="input"
          placeholder="https://business.example.com"
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
        Save and reload
      </button>
    </div>
  );
}

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card stack-lg">
        <div className="row">
          <img src="./icon.svg" alt="" width={44} height={44} />
          <div>
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        <div className="card stack">{children}</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <ServerSettings />
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to OVL For Business">
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field label="Username or email">
          <input
            className="input"
            autoComplete="username"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
          />
        </Field>
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
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="small muted">
        No account yet? <Link to="/register">Create a personal account</Link>
      </p>
    </AuthCard>
  );
}

export function RegisterPage() {
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
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      subtitle="A personal account first — register companies, licenses and more from inside."
    >
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field label="Display name">
          <input
            className="input"
            value={form.displayName}
            onChange={set('displayName')}
            required
            maxLength={64}
          />
        </Field>
        <Field label="Username" hint="3–32 characters: letters, digits and underscore.">
          <input
            className="input"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
            required
            pattern="[A-Za-z][A-Za-z0-9_]{2,31}"
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
          />
        </Field>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="small muted">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}
