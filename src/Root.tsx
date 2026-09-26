import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRight, Building2, KeyRound, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import App from './App';
import FieldApp from './FieldApp';
import { AgentOnboarding } from './FieldProfile';
import PlatformApp from './PlatformApp';
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

  function apply(next: Session) { saveSession(next); setSession(next); }

  function logout() {
    if (session) void api.logout(session.token).catch(() => undefined);
    clearSession();
    setSession(null);
  }

  if (checking) return <div className="auth-shell"><div className="auth-card loading"><LoaderCircle className="spin" size={24} /> Restoring your secure workspace…</div></div>;
  if (!session) return <LoginPage onSession={apply} />;
  if (session.user.role === 'agent' && session.user.onboardingComplete === false) {
    return <AgentOnboarding session={session} onDone={(user) => apply({ ...session, user })} onLogout={logout} />;
  }
  if (session.user.role === 'platform_admin') return <PlatformApp session={session} onLogout={logout} />;
  const onSessionUpdate = (user: Session['user']) => apply({ ...session, user });
  return session.user.role === 'agent' ? <FieldApp session={session} onLogout={logout} onSessionUpdate={onSessionUpdate} /> : <App session={session} onLogout={logout} onSessionUpdate={onSessionUpdate} />;
}

type LoginMode = 'signin' | 'choose' | 'finance' | 'agent';

// Sign in, or create an account as a finance company (new company + owner) or as a field agent.
function LoginPage({ onSession }: { onSession: (session: Session) => void }) {
  const defaults = loginDefaults(import.meta.env.DEV);
  const [mode, setMode] = useState<LoginMode>('signin');
  const [mobile, setMobile] = useState(defaults.mobile);
  const [company, setCompany] = useState({ companyName: '', name: '', city: '' });
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'finance' || mode === 'agent';

  function reset(nextMode: LoginMode) { setMode(nextMode); setChallengeId(''); setCode(''); setDevelopmentCode(''); setError(''); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (!challengeId) {
        const challenge = signup ? await api.signupRequestOtp(mobile) : await api.requestOtp(mobile);
        setChallengeId(challenge.challengeId);
        setDevelopmentCode(challenge.developmentCode ?? '');
      } else {
        onSession(mode === 'finance' ? await api.financeSignupVerify(mobile, code, challengeId, company)
          : mode === 'agent' ? await api.signupVerify(mobile, code, challengeId)
          : await api.verifyOtp(mobile, code, challengeId));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong.'); } finally { setBusy(false); }
  }

  const heading = challengeId ? 'Enter your one-time code'
    : mode === 'choose' ? 'Create your Handoff account'
    : mode === 'finance' ? 'Register your finance company'
    : mode === 'agent' ? 'Create your agent account'
    : 'Sign in to your workspace';
  const intro = challengeId ? `We sent a code to ${mobile}.`
    : mode === 'choose' ? 'Tell us how you will use Handoff.'
    : mode === 'finance' ? 'You become the owner of your company workspace and can add your team and agents after signing in.'
    : mode === 'agent' ? 'Register as an independent field agent with your mobile number.'
    : 'Use the mobile number registered with your finance company.';

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><img className="auth-logo" src="/handoff-logo.png" alt="Handoff" /></div>
    <div className="auth-intro">
      <p className="eyebrow">Recovery operations</p>
      <h1>{heading}</h1>
      <p>{intro}</p>
    </div>
    {mode === 'choose'
      ? <div className="account-types">
          <button type="button" onClick={() => reset('finance')}><Building2 size={20} /><span><strong>Finance company</strong><small>Import loan accounts, assign agents and track recoveries</small></span><ArrowRight size={16} /></button>
          <button type="button" onClick={() => reset('agent')}><UserRound size={20} /><span><strong>Field agent</strong><small>Receive recovery and verification jobs from financers</small></span><ArrowRight size={16} /></button>
        </div>
      : <form onSubmit={submit}>
          {!challengeId && mode === 'finance' && <>
            <label>Finance company name<input value={company.companyName} onChange={(event) => setCompany({ ...company, companyName: event.target.value })} required minLength={2} maxLength={255} autoComplete="organization" /></label>
            <label>Your full name<input value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} required minLength={2} maxLength={100} autoComplete="name" /></label>
            <label>City<input value={company.city} onChange={(event) => setCompany({ ...company, city: event.target.value })} required minLength={2} maxLength={100} autoComplete="address-level2" /></label>
          </>}
          {!challengeId
            ? <label>{signup ? 'Your mobile number' : 'Registered mobile number'}<input value={mobile} onChange={(event) => setMobile(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" required /></label>
            : <label>One-time code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} type="text" inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={8} required autoFocus /></label>}
          {developmentCode && <p className="auth-protection"><ShieldCheck size={15} /> Local development OTP: {developmentCode}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {challengeId ? (mode === 'finance' ? 'Verify and create company' : signup ? 'Verify and continue' : 'Verify and sign in') : 'Send one-time code'}</button>
          {challengeId && <button className="text-button" type="button" onClick={() => reset(mode)}>Change details</button>}
        </form>}
    {!challengeId && (mode === 'signin'
      ? <button className="text-button auth-switch" type="button" onClick={() => reset('choose')}>New to Handoff? Create an account</button>
      : <button className="text-button auth-switch" type="button" onClick={() => reset(mode === 'choose' ? 'signin' : 'choose')}>{mode === 'choose' ? 'Have an account? Sign in' : 'Back'}</button>)}
    {defaults.showDemoAccounts && mode === 'signin' && <div className="demo-logins"><p>Local demo accounts</p><button type="button" onClick={() => { setMobile('+91 98450 11111'); reset('signin'); }}>Finance super-admin</button><button type="button" onClick={() => { setMobile('+91 98451 22014'); reset('signin'); }}>Android field agent</button></div>}
    {!Capacitor.isNativePlatform() && <a className="text-button auth-download" href="/download/handoff-field.apk" download>Field agent? Download the Android app</a>}
    <div className="auth-protection"><ShieldCheck size={15} /> OTP login and revocable sessions enabled</div>
  </section></main>;
}

export default Root;
