import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import App from './App';
import FieldApp from './FieldApp';
import { api, clearSession, saveSession, storedSession } from './api';
import type { Session } from './api';

function Root() {
  const [session, setSession] = useState<Session | null>(() => storedSession());
  const [checking, setChecking] = useState(Boolean(storedSession()));

  useEffect(() => {
    const current = storedSession();
    if (!current) return;
    api.me(current.token)
      .then(({ user }) => setSession({ ...current, user }))
      .catch(() => { clearSession(); setSession(null); })
      .finally(() => setChecking(false));
  }, []);

  function logout() {
    clearSession();
    setSession(null);
  }

  if (checking) return <div className="auth-shell"><div className="auth-card loading"><LoaderCircle className="spin" size={24} /> Restoring your secure workspace…</div></div>;
  if (!session) return <LoginPage onSession={(nextSession) => { saveSession(nextSession); setSession(nextSession); }} />;
  return session.user.role === 'agent' ? <FieldApp session={session} onLogout={logout} /> : <App session={session} onLogout={logout} />;
}

function LoginPage({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState('admin@aaryafinance.test');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try { onSession(await api.login(email, password)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); } finally { setBusy(false); }
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><i /><i /><i /></span>handoff</div><div className="auth-intro"><p className="eyebrow">Recovery operations</p><h1>Sign in to your workspace</h1><p>Your view is restricted to your financer role and assigned cases.</p></div><form onSubmit={signIn}><label>Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{error && <p className="auth-error">{error}</p>}<button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} Sign in</button></form><div className="demo-logins"><p>Local demo accounts</p><button type="button" onClick={() => { setEmail('admin@aaryafinance.test'); setPassword('demo123'); }}>Finance super-admin</button><button type="button" onClick={() => { setEmail('ravi@field.test'); setPassword('demo123'); }}>Android field agent</button></div><div className="auth-protection"><ShieldCheck size={15} /> Local API with tenant and role checks enabled</div></section></main>;
}

export default Root;
