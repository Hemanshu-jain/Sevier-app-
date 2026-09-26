import { useState } from 'react';
import type { FormEvent, InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronDown, IdCard, IndianRupee, LoaderCircle, LogOut, MapPinned, UserRound } from 'lucide-react';
import { api } from './api';
import type { ProfileInput, Session, SessionUser } from './api';

type IdType = 'aadhaar' | 'pan';
type ProfileDraft = {
  firstName: string; lastName: string; addressLine1: string; addressLine2: string; city: string; pincode: string;
  rateVehicle: string; rateVerification: string; idProofType: IdType; idProof: string;
};

// ponytail: mirrors server/agent-profile.mjs ID_FORMATS for instant feedback; the server re-checks.
const ID_FORMATS: Record<IdType, RegExp> = { aadhaar: /^\d{12}$/, pan: /^[A-Z]{5}\d{4}[A-Z]$/ };
const cleanId = (value: string) => value.replace(/\s+/g, '').toUpperCase();

function draftFromUser(user: SessionUser): ProfileDraft {
  const [firstName = '', ...rest] = user.name === 'New agent' ? [] : user.name.trim().split(/\s+/);
  const profile = user.profile;
  return {
    firstName, lastName: rest.join(' '), addressLine1: profile?.addressLine1 ?? '', addressLine2: profile?.addressLine2 ?? '',
    city: user.city ?? '', pincode: profile?.pincode ?? '', rateVehicle: user.rates?.vehicle?.toString() ?? '',
    rateVerification: user.rates?.verification?.toString() ?? '', idProofType: profile?.idProofType ?? 'aadhaar', idProof: '',
  };
}

function toInput(draft: ProfileDraft): ProfileInput {
  return {
    name: `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim(), city: draft.city.trim(), addressLine1: draft.addressLine1.trim(),
    addressLine2: draft.addressLine2.trim(), pincode: draft.pincode.trim(), idProofType: draft.idProofType, idProof: cleanId(draft.idProof),
    rateVehicle: draft.rateVehicle.trim(), rateVerification: draft.rateVerification.trim(),
  };
}

const nameValid = (d: ProfileDraft) => d.firstName.trim().length >= 1 && d.lastName.trim().length >= 1;
const addressValid = (d: ProfileDraft) => d.addressLine1.trim().length >= 3 && d.city.trim().length >= 2 && /^\d{6}$/.test(d.pincode.trim());
const idValid = (d: ProfileDraft) => ID_FORMATS[d.idProofType].test(cleanId(d.idProof));

// Downscale a picked photo to a 256px square JPEG so it can live on the user row.
async function resizePhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

// Enter moves to the next field in the form; on the last field it submits.
function nextFieldOnEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
  const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type=file]):not([type=radio])'));
  const next = fields[fields.indexOf(event.target) + 1];
  if (next) { event.preventDefault(); next.focus(); }
}

type Setter = (changes: Partial<ProfileDraft>) => void;

function Input({ label, value, onChange, ...props }: { label: string; value: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <label className="field-text-label">{label}<input value={value} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function NameFields({ draft, set, autoFocus }: { draft: ProfileDraft; set: Setter; autoFocus?: boolean }) {
  return <div className="profile-row">
    <Input label="First name" value={draft.firstName} onChange={(firstName) => set({ firstName })} autoFocus={autoFocus} autoComplete="given-name" maxLength={50} placeholder="e.g. Ravi" />
    <Input label="Last name" value={draft.lastName} onChange={(lastName) => set({ lastName })} autoComplete="family-name" maxLength={50} placeholder="e.g. Kumar" />
  </div>;
}

function AddressFields({ draft, set, autoFocus }: { draft: ProfileDraft; set: Setter; autoFocus?: boolean }) {
  return <>
    <Input label="House / flat and street" value={draft.addressLine1} onChange={(addressLine1) => set({ addressLine1 })} autoFocus={autoFocus} autoComplete="address-line1" maxLength={191} placeholder="e.g. 12, MG Road" />
    <Input label="Area / landmark" value={draft.addressLine2} onChange={(addressLine2) => set({ addressLine2 })} autoComplete="address-line2" maxLength={191} placeholder="e.g. Near city bus stand" />
    <div className="profile-row">
      <Input label="City" value={draft.city} onChange={(city) => set({ city })} autoComplete="address-level2" maxLength={100} placeholder="e.g. Pune" />
      <Input label="Pincode" value={draft.pincode} onChange={(pincode) => set({ pincode: pincode.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="postal-code" placeholder="411001" />
    </div>
  </>;
}

function RateFields({ draft, set, autoFocus }: { draft: ProfileDraft; set: Setter; autoFocus?: boolean }) {
  const rate = { type: 'number', inputMode: 'numeric' as const, min: 0, max: 100000, step: 1, placeholder: 'Not set' };
  return <>
    <Input label="Vehicle seizing (₹ per job)" value={draft.rateVehicle} onChange={(rateVehicle) => set({ rateVehicle })} autoFocus={autoFocus} {...rate} />
    <Input label="House verification (₹ per job)" value={draft.rateVerification} onChange={(rateVerification) => set({ rateVerification })} {...rate} />
    <p className="profile-hint">Financers see these rates when they choose an agent.</p>
  </>;
}

function IdFields({ draft, set, current, autoFocus }: { draft: ProfileDraft; set: Setter; current?: string; autoFocus?: boolean }) {
  return <>
    <div className="profile-segment" role="radiogroup" aria-label="ID proof type">
      {(['aadhaar', 'pan'] as const).map((type) => <label key={type} className={draft.idProofType === type ? 'active' : ''}><input type="radio" name="id-type" checked={draft.idProofType === type} onChange={() => set({ idProofType: type, idProof: '' })} />{type === 'aadhaar' ? 'Aadhaar card' : 'PAN card'}</label>)}
    </div>
    <Input label={draft.idProofType === 'aadhaar' ? 'Aadhaar number (12 digits)' : 'PAN number'} value={draft.idProof} autoFocus={autoFocus}
      onChange={(idProof) => set({ idProof: draft.idProofType === 'aadhaar' ? idProof.replace(/[^\d ]/g, '').slice(0, 14) : idProof.toUpperCase().slice(0, 10) })}
      inputMode={draft.idProofType === 'aadhaar' ? 'numeric' : 'text'} autoCapitalize="characters" placeholder={current ? `On file: •••• ${current} · type to replace` : draft.idProofType === 'aadhaar' ? '1234 5678 9012' : 'ABCDE1234F'} />
    {draft.idProof && !idValid(draft) && <p className="profile-hint warn">{draft.idProofType === 'aadhaar' ? 'Aadhaar must be 12 digits.' : 'PAN looks like ABCDE1234F.'}</p>}
  </>;
}

function Avatar({ src, size = 64 }: { src?: string | null; size?: number }) {
  return <span className="profile-avatar" style={{ width: size, height: size }}>{src ? <img src={src} alt="" /> : <UserRound size={size * 0.42} />}</span>;
}

function PhotoPicker({ src, busy, onPick }: { src?: string | null; busy?: boolean; onPick: (photo: string) => void }) {
  const [error, setError] = useState('');
  async function pick(file?: File) {
    if (!file) return;
    setError('');
    try { onPick(await resizePhoto(file)); } catch { setError('That photo could not be read. Try another one.'); }
  }
  return <div className="profile-photo">
    <label className="profile-photo-button" aria-label="Choose profile photo">
      <Avatar src={src} size={84} />
      <span className="profile-photo-badge">{busy ? <LoaderCircle className="spin" size={14} /> : <Camera size={14} />}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void pick(event.target.files?.[0])} />
    </label>
    {error && <p className="profile-hint warn" role="alert">{error}</p>}
  </div>;
}

function Section({ icon, title, summary, children }: { icon: ReactNode; title: string; summary: string; children: ReactNode }) {
  return <details className="profile-section">
    <summary>{icon}<span><strong>{title}</strong><small>{summary}</small></span><ChevronDown size={18} /></summary>
    <div className="profile-section-body">{children}</div>
  </details>;
}

// The Profile tab: photo + name up top, then collapsible segments that save independently.
export function FieldProfile({ session, onSaved, onNotice, onLogout }: { session: Session; onSaved: (user: SessionUser) => void; onNotice: (message: string, ok?: boolean) => void; onLogout: () => void }) {
  const user = session.user;
  const [draft, setDraft] = useState(() => draftFromUser(user));
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const set: Setter = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const idLabel = user.profile?.idProofType === 'pan' ? 'PAN' : 'Aadhaar';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValid(draft)) return onNotice('Enter your first and last name.');
    if (!addressValid(draft)) return onNotice('Complete your address with a 6-digit pincode.');
    if (draft.idProof && !idValid(draft)) return onNotice(`Check your ${draft.idProofType === 'aadhaar' ? 'Aadhaar' : 'PAN'} number.`);
    setSaving(true);
    try {
      const { user: saved } = await api.updateProfile(session.token, toInput(draft));
      set({ idProof: '' });
      onSaved(saved);
      onNotice('Profile updated', true);
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Your profile could not be saved.'); } finally { setSaving(false); }
  }

  async function savePhoto(photo: string) {
    setPhotoBusy(true);
    try { onSaved((await api.updateProfilePhoto(session.token, photo)).user); onNotice('Photo updated', true); }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Your photo could not be saved.'); } finally { setPhotoBusy(false); }
  }

  const saveButton = <button className="field-primary" type="submit" disabled={saving}><Check size={18} /> {saving ? 'Saving…' : 'Save'}</button>;
  return <>
    <div className="profile-hero"><PhotoPicker src={user.profile?.avatar} busy={photoBusy} onPick={(photo) => void savePhoto(photo)} /><div><h1>{user.name}</h1><p>{user.mobile}</p></div></div>
    <form className="profile-sections" onSubmit={save} onKeyDown={nextFieldOnEnter}>
      <Section icon={<UserRound size={19} />} title="Profile" summary={[user.profile?.addressLine1, user.city].filter(Boolean).join(', ') || 'Name, address and mobile'}>
        <NameFields draft={draft} set={set} />
        <AddressFields draft={draft} set={set} />
        <label className="field-text-label">Mobile number<input value={user.mobile ?? ''} readOnly disabled /></label>
        {saveButton}
      </Section>
      <Section icon={<IndianRupee size={19} />} title="Your rates" summary={`Seizing ${user.rates?.vehicle != null ? `₹${user.rates.vehicle}` : 'not set'} · Verification ${user.rates?.verification != null ? `₹${user.rates.verification}` : 'not set'}`}>
        <RateFields draft={draft} set={set} />
        {saveButton}
      </Section>
      <Section icon={<IdCard size={19} />} title="Other information" summary={user.profile?.idProofLast4 ? `${idLabel} •••• ${user.profile.idProofLast4}` : 'Add Aadhaar or PAN'}>
        <IdFields draft={draft} set={set} current={user.profile?.idProofLast4 ?? undefined} />
        {saveButton}
      </Section>
    </form>
    <button className="field-secondary field-signout" type="button" onClick={onLogout}><LogOut size={17} /> Sign out</button>
  </>;
}

const onboardingSteps = [
  { key: 'name', icon: UserRound, title: 'What is your name?', copy: 'Use the name on your ID proof.', valid: nameValid },
  { key: 'address', icon: MapPinned, title: 'Where do you live?', copy: 'Your address is shared only with finance companies you work for.', valid: addressValid },
  { key: 'id', icon: IdCard, title: 'Add your ID proof', copy: 'Required. Finance companies verify agents before assigning work.', valid: idValid },
  { key: 'rates', icon: IndianRupee, title: 'Set your rates', copy: 'Optional. You can change these any time.', valid: () => true },
  { key: 'photo', icon: Camera, title: 'Add a profile photo', copy: 'Optional. Helps the finance team recognise you.', valid: () => true },
] as const;

// First-run walkthrough for a new agent: one section per screen, Enter moves field to field.
export function AgentOnboarding({ session, onDone, onLogout }: { session: Session; onDone: (user: SessionUser) => void; onLogout: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => draftFromUser(session.user));
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set: Setter = (changes) => { setError(''); setDraft((current) => ({ ...current, ...changes })); };
  const current = onboardingSteps[step];
  const last = step === onboardingSteps.length - 1;
  const Icon = current.icon;

  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current.valid(draft)) return;
    if (!last) { setStep(step + 1); return; }
    setBusy(true); setError('');
    try {
      let { user } = await api.updateProfile(session.token, toInput(draft));
      if (photo) user = (await api.updateProfilePhoto(session.token, photo)).user;
      onDone(user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); setBusy(false); }
  }

  return <main className="field-app onboarding">
    <div className="onboarding-progress" aria-hidden="true">{onboardingSteps.map((item, index) => <span key={item.key} className={index <= step ? 'done' : ''} />)}</div>
    <form className="onboarding-body" onSubmit={next} onKeyDown={nextFieldOnEnter} key={current.key}>
      <p className="onboarding-step">Step {step + 1} of {onboardingSteps.length}</p>
      <span className="onboarding-icon"><Icon size={22} /></span>
      <h1>{current.title}</h1>
      <p className="onboarding-copy">{current.copy}</p>
      {current.key === 'name' && <NameFields draft={draft} set={set} autoFocus />}
      {current.key === 'address' && <AddressFields draft={draft} set={set} autoFocus />}
      {current.key === 'id' && <IdFields draft={draft} set={set} autoFocus />}
      {current.key === 'rates' && <RateFields draft={draft} set={set} autoFocus />}
      {current.key === 'photo' && <PhotoPicker src={photo} onPick={setPhoto} />}
      {current.key === 'photo' && <label className="field-text-label">Mobile number<input value={session.user.mobile ?? ''} readOnly disabled /></label>}
      {error && <p className="field-form-error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        {step > 0 && <button className="field-secondary" type="button" disabled={busy} onClick={() => setStep(step - 1)}><ArrowLeft size={17} /> Back</button>}
        <button className="field-primary" type="submit" disabled={busy || !current.valid(draft)}>
          {busy ? <LoaderCircle className="spin" size={17} /> : last ? <Check size={17} /> : <ArrowRight size={17} />} {last ? (photo ? 'Finish setup' : 'Skip and finish') : 'Continue'}
        </button>
      </div>
    </form>
    <button className="onboarding-signout" type="button" onClick={onLogout}>Sign out</button>
  </main>;
}

export { Avatar };
