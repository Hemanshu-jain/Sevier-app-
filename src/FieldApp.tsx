import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, CarFront, Check, ChevronRight, CircleAlert, ClipboardCheck, Cloud, Crosshair, FileCheck2, LogOut, MapPinned, Phone, Save, ShieldAlert, Upload, WifiOff, X } from 'lucide-react';
import { api } from './api';
import type { Session } from './api';
import type { AttemptReason, EvidenceRecord, RecoveryCase } from './types';

const reasonOptions: AttemptReason[] = ['Vehicle not found', 'Vehicle details mismatch', 'Unsafe situation', 'Customer dispute', 'Authority issue', 'Other'];
const agentChecklist = ['Battery', 'Spare tyre', 'Fuel level', 'Matting', 'Keys and key number', 'Meter / odometer', 'Existing damages', 'Self motor', 'Wiper / motor', 'Stereo / infotainment', 'Ignition coil', 'Speakers', 'Side mirrors', 'Tyre condition'];
const inspectionOptions = ['', 'Present / working', 'Missing', 'Damaged', 'Not applicable'];

type FieldStep = 'work' | 'verify' | 'evidence' | 'custody';
type FieldLocation = { latitude: number; longitude: number; capturedAt: string };
type FieldDraft = {
  registration: string;
  chassisLastSix: string;
  verified: boolean;
  location?: FieldLocation;
  inspection: Record<string, string>;
  yardName: string;
  parkingRate: string;
  note: string;
  handoverConfirmed: boolean;
};

function createDraft(): FieldDraft {
  return { registration: '', chassisLastSix: '', verified: false, inspection: {}, yardName: '', parkingRate: '', note: '', handoverConfirmed: false };
}

function draftKey(userId: string, caseId: string) {
  return `handoff-agent-draft:${userId}:${caseId}`;
}

function normalise(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function FieldApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [assignments, setAssignments] = useState<RecoveryCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<FieldStep>('work');
  const [draft, setDraft] = useState<FieldDraft>(createDraft);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showAttempt, setShowAttempt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const selected = assignments.find((item) => item.id === selectedId) ?? null;

  async function refresh() {
    const workspace = await api.workspace(session.token);
    setAssignments(workspace.cases);
  }

  useEffect(() => {
    refresh().catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const updateStatus = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => { window.removeEventListener('online', updateStatus); window.removeEventListener('offline', updateStatus); };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const saved = localStorage.getItem(draftKey(session.user.id, selectedId));
    try { setDraft(saved ? { ...createDraft(), ...JSON.parse(saved) } : createDraft()); } catch { setDraft(createDraft()); }
    setStep('work');
    setEvidence([]);
    setPendingFiles([]);
    api.evidence(session.token, selectedId).then(({ evidence: records }) => setEvidence(records)).catch(() => undefined);
  }, [selectedId, session.token, session.user.id]);

  useEffect(() => {
    if (selectedId) localStorage.setItem(draftKey(session.user.id, selectedId), JSON.stringify(draft));
  }, [draft, selectedId, session.user.id]);

  const inspectionComplete = useMemo(() => agentChecklist.every((item) => Boolean(draft.inspection[item])), [draft.inspection]);
  const vehicleMatches = selected && normalise(draft.registration) === normalise(selected.vehicle.registration) && normalise(draft.chassisLastSix) === normalise(selected.vehicle.chassis.slice(-6));
  const canFinishCustody = Boolean(vehicleMatches && draft.verified && draft.location && evidence.length && inspectionComplete && draft.yardName.trim() && Number(draft.parkingRate) >= 0 && draft.handoverConfirmed);

  function updateDraft(changes: Partial<FieldDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  async function captureLocation() {
    if (!navigator.geolocation) { setNotice('This device cannot provide a location. Use a GPS-enabled Android phone.'); return; }
    setWorking(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }));
      updateDraft({ location: { latitude: position.coords.latitude, longitude: position.coords.longitude, capturedAt: new Date().toISOString() } });
      setNotice('Live location captured for this work order.');
    } catch {
      setNotice('Location was not captured. Enable precise location permission and try again.');
    } finally { setWorking(false); }
  }

  async function uploadEvidence() {
    if (!selected || !pendingFiles.length) { setNotice('Capture at least one photo or video first.'); return; }
    setWorking(true);
    try {
      const response = await api.uploadEvidence(session.token, selected.id, pendingFiles, draft.location);
      setEvidence((current) => [...response.evidence, ...current]);
      setPendingFiles([]);
      setNotice(`${response.evidence.length} evidence file${response.evidence.length === 1 ? '' : 's'} saved securely.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Evidence could not be uploaded.'); } finally { setWorking(false); }
  }

  async function updateAttempt(reason: AttemptReason, note: string) {
    if (!selected) return;
    setWorking(true);
    try {
      await api.recordAttempt(session.token, selected.id, reason, note || 'No additional field note recorded.', draft.location);
      localStorage.removeItem(draftKey(session.user.id, selected.id));
      await refresh();
      setShowAttempt(false);
      setSelectedId(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The field update could not be saved.'); } finally { setWorking(false); }
  }

  async function submitCustody() {
    if (!selected || !canFinishCustody || !draft.location) return;
    setWorking(true);
    try {
      await api.recordCustody(session.token, selected.id, {
        yardName: draft.yardName.trim(),
        arrivalTime: new Date().toISOString(),
        parkingRate: Number(draft.parkingRate),
        checklist: agentChecklist.length,
        inspection: draft.inspection,
        latitude: draft.location.latitude,
        longitude: draft.location.longitude,
      });
      localStorage.removeItem(draftKey(session.user.id, selected.id));
      await refresh();
      setNotice('Custody certificate submitted to the finance company.');
      setSelectedId(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Custody certificate could not be submitted.'); } finally { setWorking(false); }
  }

  if (selected) {
    const workIsComplete = ['Custody review', 'Payment pending', 'Payment confirmed', 'Release pass printed', 'Closed'].includes(selected.status);
    return <main className="field-app"><header className="field-header"><button onClick={() => setSelectedId(null)} aria-label="Back to assignments"><ArrowLeft size={20} /></button><div><span>ACTIVE WORK ORDER</span><strong>{selected.id}</strong></div><button onClick={onLogout} aria-label="Sign out"><LogOut size={19} /></button></header>
      <section className="field-case">
        {notice && <div className="field-notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
        {!online && <div className="field-offline"><WifiOff size={16} /> Offline — your form draft is saved on this device. Upload and submit when connected.</div>}
        <div className="field-status"><span>{workIsComplete ? 'REPORT SUBMITTED' : 'FINANCE ASSIGNED'}</span><small>Updated {new Date(selected.updatedAt).toLocaleString()}</small></div>
        <div className="field-vehicle-head"><span>{selected.vehicle.type === '2-wheeler' ? '2W' : '4W'}</span><div><h1>{selected.vehicle.registration}</h1><p>{selected.vehicle.makeModel}</p></div></div>
        <section className="field-info-card"><p className="field-label">Customer and loan information</p><div className="field-person"><strong>{selected.borrower.name}</strong><span>{selected.borrower.mobile}</span></div><p className="field-address"><MapPinned size={15} /> {selected.borrower.address}</p><div className="field-loan-grid"><span><small>Account</small><strong>{selected.accountNumber}</strong></span><span><small>Pending amount</small><strong>₹{selected.pendingAmount.toLocaleString('en-IN')}</strong></span><span><small>Overdue</small><strong>{selected.overdueDays} days</strong></span><span><small>Chassis no.</small><strong>{selected.vehicle.chassis.slice(-8)}</strong></span></div><div className="field-quick-actions"><a href={`tel:${selected.borrower.mobile.replaceAll(' ', '')}`}><Phone size={15} /> Call customer</a><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.borrower.address)}`} target="_blank" rel="noreferrer"><MapPinned size={15} /> Open address</a></div></section>
        {selected.assignmentNote && <section className="field-instruction"><ShieldAlert size={16} /><div><strong>Finance instruction</strong><p>{selected.assignmentNote}</p></div></section>}
        {workIsComplete ? <section className="field-complete-card"><FileCheck2 size={24} /><div><strong>Custody report already submitted</strong><p>This work order is now with the finance team. No further field action is needed.</p></div></section> : <>
          <FieldSteps step={step} onChange={setStep} evidenceCount={evidence.length} />
          {step === 'work' && <section className="field-step-card"><div className="field-guardrail"><ShieldAlert size={19} /><div><strong>Stop conditions</strong><p>Do not proceed if vehicle details do not match, authority is invalid, or the situation is unsafe.</p></div></div><button className="field-primary" onClick={() => setStep('verify')}><ClipboardCheck size={18} /> Start verification</button><button className="field-secondary" onClick={() => setShowAttempt(true)}><CircleAlert size={17} /> Unable to recover</button></section>}
          {step === 'verify' && <section className="field-step-card"><StepHeading eyebrow="STEP 1 OF 3" title="Verify the vehicle" copy="Check the vehicle against the assigned work order before taking custody." /><label className="field-text-label">Registration number<input autoCapitalize="characters" value={draft.registration} onChange={(event) => updateDraft({ registration: event.target.value, verified: false })} placeholder="Enter vehicle number" /></label><label className="field-text-label">Last 6 characters of chassis number<input autoCapitalize="characters" value={draft.chassisLastSix} onChange={(event) => updateDraft({ chassisLastSix: event.target.value, verified: false })} placeholder="Enter last 6 characters" /></label><div className={`field-match ${vehicleMatches ? 'confirmed' : ''}`}><Check size={17} /><span>{vehicleMatches ? 'Vehicle details match the work order.' : 'Enter both values exactly as shown on the vehicle.'}</span></div><button className="field-location" onClick={captureLocation} disabled={working}><Crosshair size={18} /><span>{draft.location ? `Location captured · ${draft.location.latitude.toFixed(5)}, ${draft.location.longitude.toFixed(5)}` : 'Capture current GPS location'}</span></button><button className="field-primary" disabled={!vehicleMatches || !draft.location} onClick={() => { updateDraft({ verified: true }); setStep('evidence'); }}><Check size={18} /> Confirm and continue</button></section>}
          {step === 'evidence' && <section className="field-step-card"><StepHeading eyebrow="STEP 2 OF 3" title="Capture custody evidence" copy="Take clear photos or a short video of the vehicle before moving it." /><label className="field-file-picker"><Camera size={22} /><strong>Take photos or video</strong><span>Up to 5 files · 15 MB each</span><input type="file" accept="image/*,video/*" capture="environment" multiple onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []).slice(0, 5))} /></label>{pendingFiles.length > 0 && <div className="field-file-list">{pendingFiles.map((file) => <span key={`${file.name}-${file.lastModified}`}><Camera size={14} /> {file.name}</span>)}</div>}<button className="field-secondary field-upload" disabled={!pendingFiles.length || working || !online} onClick={uploadEvidence}><Upload size={17} /> {working ? 'Saving evidence…' : 'Save selected evidence'}</button><div className="field-evidence-count"><Cloud size={17} /><span><strong>{evidence.length} evidence file{evidence.length === 1 ? '' : 's'} saved</strong><small>Evidence is linked only to this work order.</small></span></div><button className="field-primary" disabled={!evidence.length} onClick={() => setStep('custody')}><ChevronRight size={18} /> Continue to check slip</button></section>}
          {step === 'custody' && <section className="field-step-card"><StepHeading eyebrow="STEP 3 OF 3" title="Digital parking check slip" copy="Record the condition at handover. Every row needs a selection." /><div className="field-checklist-select">{agentChecklist.map((item) => <label key={item}><span>{item}</span><select value={draft.inspection[item] ?? ''} onChange={(event) => updateDraft({ inspection: { ...draft.inspection, [item]: event.target.value } })}>{inspectionOptions.map((option) => <option key={option} value={option}>{option || 'Select condition'}</option>)}</select></label>)}</div><label className="field-text-label">Parking location<input value={draft.yardName} onChange={(event) => updateDraft({ yardName: event.target.value })} placeholder="Enter yard or parking location" /></label><label className="field-text-label">Daily parking rate (₹)<input type="number" min="0" inputMode="numeric" value={draft.parkingRate} onChange={(event) => updateDraft({ parkingRate: event.target.value })} placeholder="e.g. 350" /></label><label className="field-text-label">Field note (optional)<textarea value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Visible damage, handover notes, or other factual details…" /></label><label className="field-confirm"><input type="checkbox" checked={draft.handoverConfirmed} onChange={(event) => updateDraft({ handoverConfirmed: event.target.checked })} /><span>I confirm the inspection above reflects the vehicle at handover.</span></label><button className="field-primary" disabled={!canFinishCustody || working || !online} onClick={submitCustody}><Check size={18} /> {working ? 'Submitting custody…' : 'Submit custody certificate'}</button><p className="field-draft-note"><Save size={14} /> Draft is saved securely on this phone until submission.</p></section>}
        </>}
      </section>{showAttempt && <FailedAttemptDialog onClose={() => setShowAttempt(false)} onSave={updateAttempt} busy={working} />}
    </main>;
  }

  return <main className="field-app"><header className="field-header home"><div className="field-brand"><span className="field-mark"><i /><i /><i /></span>handoff</div><button onClick={onLogout} aria-label="Sign out" className="field-bell"><LogOut size={19} /></button></header><section className="field-home">{notice && <div className="field-notice"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}<p className="field-greeting">Good day, {session.user.name.split(' ')[0]}</p><h1>Your assignments</h1><p className="field-copy">Only work orders assigned to you are shown here.</p>{loading ? <p className="field-copy">Loading secure assignments…</p> : <><div className="field-summary"><span><strong>{assignments.filter((item) => ['Assigned', 'Attempt in progress', 'Unable to recover'].includes(item.status)).length}</strong>active</span><span><strong>{assignments.filter((item) => item.status === 'Unable to recover').length}</strong>field updates</span></div><div className="field-filter"><span>Assigned work orders</span><ChevronRight size={16} /></div><section className="assignment-cards">{assignments.map((item) => { const submitted = ['Custody review', 'Payment pending', 'Payment confirmed', 'Release pass printed', 'Closed'].includes(item.status); return <button className="field-assignment" key={item.id} onClick={() => setSelectedId(item.id)}><div><span className={`field-case-icon ${item.vehicle.type === '2-wheeler' ? 'bike' : ''}`}><CarFront size={17} /></span><div><p>{item.id}</p><h2>{item.vehicle.registration}</h2><small>{item.vehicle.makeModel}</small></div><ChevronRight size={18} /></div><section><span className={item.status === 'Unable to recover' ? 'field-tag warning' : submitted ? 'field-tag complete' : 'field-tag'}>{item.status === 'Unable to recover' ? 'FIELD UPDATE SENT' : submitted ? 'REPORT SUBMITTED' : 'READY TO START'}</span><p>{item.borrower.name} · {item.borrower.address}</p></section></button>; })}</section></>}<div className="field-footer-note"><ShieldAlert size={16} /> Every field update is time-stamped, tenant-scoped, and sent to the finance company.</div></section></main>;
}

function StepHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="field-step-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function FieldSteps({ step, onChange, evidenceCount }: { step: FieldStep; onChange: (step: FieldStep) => void; evidenceCount: number }) {
  const items: Array<{ id: FieldStep; label: string; number: number }> = [{ id: 'verify', label: 'Verify', number: 1 }, { id: 'evidence', label: 'Evidence', number: 2 }, { id: 'custody', label: 'Check slip', number: 3 }];
  return <nav className="field-steps" aria-label="Recovery progress">{items.map((item) => <button key={item.id} className={step === item.id ? 'active' : ''} onClick={() => onChange(item.id)}><span>{item.id === 'evidence' && evidenceCount ? <Check size={13} /> : item.number}</span>{item.label}</button>)}</nav>;
}

function FailedAttemptDialog({ onClose, onSave, busy }: { onClose: () => void; onSave: (reason: AttemptReason, note: string) => void; busy: boolean }) {
  const [reason, setReason] = useState<AttemptReason>('Vehicle not found');
  const [note, setNote] = useState('');
  return <div className="field-modal-backdrop"><section className="field-modal"><div className="field-modal-top"><div><span>FIELD UPDATE</span><h2>Unable to recover</h2></div><button onClick={onClose}><X size={19} /></button></div><p>Select the most accurate reason, then add a factual note for the finance team.</p><div className="field-reason-list">{reasonOptions.map((item) => <label key={item}><input type="radio" checked={reason === item} onChange={() => setReason(item)} /><span>{item}</span></label>)}</div><label className="field-text-label">Custom note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add what happened during this attempt…" /></label><button disabled={busy} className="field-primary" onClick={() => onSave(reason, note)}>{busy ? 'Sending update…' : 'Send field update'}</button></section></div>;
}

export default FieldApp;
