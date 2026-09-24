import { ErrorAlert, Field } from '@ovl/ui';
import { useState } from 'react';
import { useAdminAuth } from '../auth';

export function LoginPage() {
  const { login } = useAdminAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="center" style={{ minHeight: '100%', background: '#151a23' }}>
      <form
        className="card stack"
        style={{ width: 'min(400px, 100%)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(form.login, form.password);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="row">
          <img src="./icon.svg" alt="" width={40} height={40} />
          <div>
            <h2>Admin panel</h2>
            <p className="small muted">Staff only: moderators, finance managers, admins and the owner.</p>
          </div>
        </div>
        <ErrorAlert error={error} />
        <Field label="Username or email">
          <input
            className="input"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
