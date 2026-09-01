import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import App from './App';
import FieldApp from './FieldApp';
import { api, clearSession, saveSession, storedSession } from './api';
import type { Session } from './api';
import { loginDefaults } from './runtime-mode';
import { shouldClearStoredSession } from './session-restoration';

function Root() {
  const [session, setSession] = useState<Session | null>(() => storedSession());
  const [checking, setChecking] = useState(Boolean(storedSession()));

  useEffect(() => {
    const current = storedSession();
    if (!current) return;
    api.me(current.token)
      .then(({ user }) => setSession({ ...current, user }))
      .catch((error) => {
        if (shouldClearStoredSession(error)) { clearSession(); setSession(null); }
      })
      .finally(() => setChecking(false));
  }, []);

  function logout() {
    if (session) void api.logout(session.token).catch(() => undefined);
    clearSession();
    setSession(null);
  }

  if (checking) return <div className="auth-shell"><div className="auth-card loading"><LoaderCircle className="spin" size={24} /> Restoring your secure workspace…</div></div>;
  if (!session) return <LoginPage onSession={(nextSession) => { saveSession(nextSession); setSession(nextSession); }} />;
  return session.user.role === 'agent' ? <FieldApp session={session} onLogout={logout} /> : <App session={session} onLogout={logout} />;
}

function LoginPage({ onSession }: { onSession: (session: Session) => void }) {
  const defaults = loginDefaults(import.meta.env.DEV);
  const [mobile, setMobile] = useState(defaults.mobile);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (!challengeId) {
        const challenge = await api.requestOtp(mobile);
        setChallengeId(challenge.challengeId);
        setDevelopmentCode(challenge.developmentCode ?? '');
      } else {
        onSession(await api.verifyOtp(mobile, code, challengeId));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); } finally { setBusy(false); }
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><i /><i /><i /></span>handoff</div><div className="auth-intro"><p className="eyebrow">Recovery operations</p><h1>{challengeId ? 'Enter your one-time code' : 'Sign in to your workspace'}</h1><p>{challengeId ? `We sent a code to ${mobile}.` : 'Use the mobile number registered with your finance company.'}</p></div><form onSubmit={signIn}>{!challengeId ? <label>Registered mobile number<input value={mobile} onChange={(event) => setMobile(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" required /></label> : <label>One-time code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} type="text" inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={8} required autoFocus /></label>}{developmentCode && <p className="auth-protection"><ShieldCheck size={15} /> Local development OTP: {developmentCode}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {challengeId ? 'Verify and sign in' : 'Send one-time code'}</button>{challengeId && <button className="text-button" type="button" onClick={() => { setChallengeId(''); setCode(''); setDevelopmentCode(''); setError(''); }}>Change mobile number</button>}</form>{defaults.showDemoAccounts && <div className="demo-logins"><p>Local demo accounts</p><button type="button" onClick={() => { setMobile('+91 98450 11111'); setChallengeId(''); }}>Finance super-admin</button><button type="button" onClick={() => { setMobile('+91 98451 22014'); setChallengeId(''); }}>Android field agent</button></div>}<div className="auth-protection"><ShieldCheck size={15} /> OTP login and revocable sessions enabled</div></section></main>;
}

export default Root;
