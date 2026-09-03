import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import App from './App';
import FieldApp from './FieldApp';
import { api, clearSession, saveSession, storedSession } from './api';
import type { Session, SessionUser } from './api';
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
    return <OnboardingWizard session={session} onDone={(user) => apply({ ...session, user })} onLogout={logout} />;
  }
  return session.user.role === 'agent' ? <FieldApp session={session} onLogout={logout} /> : <App session={session} onLogout={logout} />;
}

function LoginPage({ onSession }: { onSession: (session: Session) => void }) {
  const defaults = loginDefaults(import.meta.env.DEV);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [mobile, setMobile] = useState(defaults.mobile);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  function reset(nextMode: 'signin' | 'signup') { setMode(nextMode); setChallengeId(''); setCode(''); setDevelopmentCode(''); setError(''); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (!challengeId) {
        const challenge = signup ? await api.signupRequestOtp(mobile) : await api.requestOtp(mobile);
        setChallengeId(challenge.challengeId);
        setDevelopmentCode(challenge.developmentCode ?? '');
      } else {
        onSession(signup ? await api.signupVerify(mobile, code, challengeId) : await api.verifyOtp(mobile, code, challengeId));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong.'); } finally { setBusy(false); }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><span className="brand-mark"><i /><i /><i /></span>handoff</div>
    <div className="auth-intro">
      <p className="eyebrow">Recovery operations</p>
      <h1>{challengeId ? 'Enter your one-time code' : signup ? 'Create your agent account' : 'Sign in to your workspace'}</h1>
      <p>{challengeId ? `We sent a code to ${mobile}.` : signup ? 'Register as an independent field agent with your mobile number.' : 'Use the mobile number registered with your finance company.'}</p>
    </div>
    <form onSubmit={submit}>
      {!challengeId
        ? <label>{signup ? 'Your mobile number' : 'Registered mobile number'}<input value={mobile} onChange={(event) => setMobile(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" required /></label>
        : <label>One-time code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} type="text" inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={8} required autoFocus /></label>}
      {developmentCode && <p className="auth-protection"><ShieldCheck size={15} /> Local development OTP: {developmentCode}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {challengeId ? (signup ? 'Verify and continue' : 'Verify and sign in') : 'Send one-time code'}</button>
      {challengeId && <button className="text-button" type="button" onClick={() => reset(mode)}>Change mobile number</button>}
    </form>
    {!challengeId && <button className="text-button auth-switch" type="button" onClick={() => reset(signup ? 'signin' : 'signup')}>{signup ? 'Have an account? Sign in' : 'New field agent? Create an account'}</button>}
    {defaults.showDemoAccounts && !signup && <div className="demo-logins"><p>Local demo accounts</p><button type="button" onClick={() => { setMobile('+91 98450 11111'); reset('signin'); }}>Finance super-admin</button><button type="button" onClick={() => { setMobile('+91 98451 22014'); reset('signin'); }}>Android field agent</button></div>}
    <div className="auth-protection"><ShieldCheck size={15} /> OTP login and revocable sessions enabled</div>
  </section></main>;
}

function OnboardingWizard({ session, onDone, onLogout }: { session: Session; onDone: (user: SessionUser) => void; onLogout: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(session.user.name === 'New agent' ? '' : session.user.name);
  const [city, setCity] = useState(session.user.city ?? '');
  const [idProof, setIdProof] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const steps = [
    { key: 'name', label: 'What is your name?', valid: name.trim().length >= 2 },
    { key: 'city', label: 'Which city do you work in?', valid: city.trim().length >= 2 },
    { key: 'id', label: 'Add an ID proof', valid: idProof.trim().length >= 4 },
    { key: 'review', label: 'Confirm your details', valid: true },
  ];
  const current = steps[step];

  async function finish() {
    setBusy(true); setError('');
    try {
      const { user } = await api.updateProfile(session.token, { name: name.trim(), city: city.trim(), idProof: idProof.trim() });
      onDone(user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); setBusy(false); }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><span className="brand-mark"><i /><i /><i /></span>handoff</div>
    <div className="auth-intro"><p className="eyebrow">Complete your profile · step {step + 1} of {steps.length}</p><h1>{current.label}</h1><p>Finish setup to start receiving assigned work orders.</p></div>
    <div className="onboard-progress">{steps.map((item, index) => <span key={item.key} className={index <= step ? 'done' : ''} />)}</div>
    {step === 0 && <label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="e.g. Ravi Kumar" /></label>}
    {step === 1 && <label className="field-label">Primary city<input value={city} onChange={(event) => setCity(event.target.value)} autoFocus placeholder="e.g. Bengaluru" /></label>}
    {step === 2 && <label className="field-label">ID proof reference<input value={idProof} onChange={(event) => setIdProof(event.target.value)} autoFocus placeholder="Aadhaar / driving licence number" /></label>}
    {step === 3 && <dl className="onboard-review"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>City</dt><dd>{city}</dd></div><div><dt>ID proof</dt><dd>{idProof}</dd></div><div><dt>Mobile</dt><dd>{session.user.mobile}</dd></div></dl>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="onboard-actions">
      {step > 0 && <button className="secondary-button" type="button" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={15} /> Back</button>}
      {step < steps.length - 1
        ? <button className="primary-button" type="button" disabled={!current.valid} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={15} /></button>
        : <button className="primary-button" type="button" disabled={busy} onClick={finish}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Finish setup</button>}
    </div>
    <button className="text-button" type="button" onClick={onLogout}>Sign out</button>
  </section></main>;
}

export default Root;
