import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft, Bell, Camera, CarFront, Check, CheckCheck, ChevronRight, CircleAlert, ClipboardCheck, Cloud,
  Crosshair, FileCheck2, LogOut, MapPinned, MessageSquare, Phone, Save, ShieldAlert,
  Upload, UserRound, X,
} from 'lucide-react';
import { api } from './api';
import type { Session, Workspace } from './api';
import {
  deleteEvidenceBlobs, deleteFieldDraft, deleteFieldMutation, deleteFieldWorkspace, listFieldMutations, loadEvidenceBlobs,
  loadFieldDraft, loadFieldWorkspace, saveEvidenceBlob, saveFieldDraft, saveFieldMutation,
  saveFieldWorkspace,
} from './field-offline';
import type { StoredFieldMutation } from './field-offline';
import { canOpenFieldStep, classifyFieldSyncError, filterAgentCases, filterCaseEvidence, nextSyncableMutation, removeEvidenceFile, validateEvidenceFiles } from './field-workflow';
import type { AttemptReason, EvidenceRecord, RecoveryCase } from './types';
import { caseStatusLabel } from './types';
import { readDeviceLocation } from './device-location';
import type { FieldLocation } from './device-location';
import FieldVerification from './FieldVerification';
import { FieldProfile, Avatar } from './FieldProfile';
import { ChatList, ChatThread } from './FieldChat';

const reasonOptions: AttemptReason[] = ['Vehicle not found', 'Vehicle details mismatch', 'Unsafe situation', 'Customer dispute', 'Authority issue', 'Other'];
const agentChecklist = ['Battery', 'Spare tyre', 'Fuel level', 'Matting', 'Keys and key number', 'Meter / odometer', 'Existing damages', 'Self motor', 'Wiper / motor', 'Stereo / infotainment', 'Ignition coil', 'Speakers', 'Side mirrors', 'Tyre condition'];
const inspectionOptions = ['', 'Present / working', 'Missing', 'Damaged', 'Not applicable'];
const emptyWorkspace: Workspace = { cases: [], custody: [], agents: [], groups: [], notifications: [], releasePasses: [], verifications: [], openOffers: [] };

type FieldView = 'submitted' | 'active' | 'messages' | 'profile' | 'notifications';
type Notice = { text: string; ok: boolean };
const AUTO_SYNC_MS = 30_000;
type FieldStep = 'work' | 'verify' | 'evidence' | 'custody';
type FieldDraft = {
  registration: string;
  chassisLastSix: string;
  verified: boolean;
  location?: FieldLocation;
  inspection: Record<string, string>;
  yardName: string;
  arrivalTime: string;
  parkingRate: string;
  customNote: string;
  handoverConfirmed: boolean;
};

function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function createDraft(): FieldDraft {
  return { registration: '', chassisLastSix: '', verified: false, inspection: {}, yardName: '', arrivalTime: localDateTime(), parkingRate: '', customNote: '', handoverConfirmed: false };
}

function legacyDraftKey(userId: string, caseId: string) {
  return `handoff-agent-draft:${userId}:${caseId}`;
}

function normalise(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function mutationLabel(operation: StoredFieldMutation['operation']) {
  return operation === 'evidence' ? 'Evidence upload' : operation === 'attempt' ? 'Unable-to-recover update' : operation === 'verification' ? 'House verification' : 'Custody certificate';
}

function FieldScreens({ session, onLogout: finishLogout, onSessionUpdate, onRequestSignOut }: { session: Session; onLogout: () => void; onSessionUpdate: (user: Session['user']) => void; onRequestSignOut: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [mutations, setMutations] = useState<StoredFieldMutation[]>([]);
  const [view, setView] = useState<FieldView>('active');
  const [chatCaseId, setChatCaseId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVerificationId, setSelectedVerificationId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [step, setStep] = useState<FieldStep>('work');
  const [draft, setDraft] = useState<FieldDraft>(createDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showAttempt, setShowAttempt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [netFlash, setNetFlash] = useState<'offline' | 'back' | null>(navigator.onLine ? null : 'offline');
  const [greeting, setGreeting] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const assignments = workspace.cases;
  const selected = assignments.find((item) => item.id === selectedId) ?? null;

  // Success messages are green and short-lived; everything else stays a little longer.
  function setNotice(text: string | null, ok = false) { setNoticeState(text ? { text, ok } : null); }

  async function onLogout() {
    try { await deleteFieldWorkspace(session.user.id); }
    finally { finishLogout(); }
  }

  async function refreshWorkspace() {
    try {
      const next = await api.workspace(session.token);
      setWorkspace(next);
      await saveFieldWorkspace(session.user.id, next);
      return true;
    } catch (error) {
      const cached = await loadFieldWorkspace<Workspace>(session.user.id);
      if (cached) setWorkspace(cached);
      setNotice(cached ? 'Showing the last saved workspace until the server is reachable.' : errorMessage(error, 'The workspace could not be loaded.'));
      return false;
    }
  }

  async function reloadMutations() {
    const stored = await listFieldMutations(session.user.id);
    const recovered = stored.map((item) => item.status === 'syncing' ? { ...item, status: 'pending' as const } : item);
    await Promise.all(recovered.filter((item, index) => item !== stored[index]).map(saveFieldMutation));
    setMutations(recovered);
    return recovered;
  }

  async function syncQueue() {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    let queue = await reloadMutations();
    let synchronized = false;
    try {
      for (let current = nextSyncableMutation(queue); current; current = nextSyncableMutation(queue)) {
        const syncingMutation: StoredFieldMutation = { ...current, status: 'syncing', attemptCount: (current.attemptCount ?? 0) + 1, error: undefined };
        await saveFieldMutation(syncingMutation);
        queue = queue.map((item) => item.id === current.id ? syncingMutation : item);
        setMutations(queue);
        try {
          if (current.operation === 'evidence') {
            const payload = current.payload as { blobIds: string[]; capturedAt: string; location?: FieldLocation };
            const blobs = await loadEvidenceBlobs(payload.blobIds);
            if (blobs.length !== payload.blobIds.length) throw new Error('One or more saved evidence files are missing from this device.');
            const files = blobs.map((item) => new File([item.blob], item.name, { type: item.type }));
            const response = await api.uploadEvidence(session.token, current.caseId, files, current.id, payload.capturedAt, payload.location);
            setEvidence((existing) => [...response.evidence, ...existing.filter((item) => !response.evidence.some((saved) => saved.id === item.id))]);
            await deleteEvidenceBlobs(payload.blobIds);
          } else if (current.operation === 'verification') {
            const payload = current.payload as { blobIds: string[]; capturedAt: string; location: FieldLocation; result: 'verified' | 'not_verified'; note: string };
            const blobs = await loadEvidenceBlobs(payload.blobIds);
            if (blobs.length !== payload.blobIds.length) throw new Error('One or more saved photos are missing from this device.');
            await api.submitVerification(session.token, current.caseId, blobs.map((item) => new File([item.blob], item.name, { type: item.type })), current.id, payload);
            await deleteEvidenceBlobs(payload.blobIds);
          } else if (current.operation === 'attempt') {
            const payload = current.payload as { reason: AttemptReason; note: string; location?: FieldLocation };
            await api.recordAttempt(session.token, current.caseId, payload.reason, payload.note, current.id, payload.location);
            await deleteFieldDraft(session.user.id, current.caseId);
          } else {
            const payload = current.payload as { values: Parameters<typeof api.recordCustody>[2] };
            await api.recordCustody(session.token, current.caseId, payload.values, current.id);
            await deleteFieldDraft(session.user.id, current.caseId);
          }
          await deleteFieldMutation(current.id);
          queue = queue.filter((item) => item.id !== current.id);
          setMutations(queue);
          synchronized = true;
        } catch (error) {
          const classification = classifyFieldSyncError(error);
          const failed: StoredFieldMutation = {
            ...syncingMutation,
            status: classification === 'needs_attention' ? 'needs_attention' : 'pending',
            error: errorMessage(error, 'Synchronization failed.'),
          };
          await saveFieldMutation(failed);
          queue = queue.map((item) => item.id === current.id ? failed : item);
          setMutations(queue);
          if (failed.status === 'needs_attention') setNotice(`${mutationLabel(current.operation)} for ${current.caseId} was not accepted: ${failed.error}`);
          if (classification === 'authentication') { await onLogout(); break; }
          if (classification === 'offline' || classification === 'retryable') break;
        }
      }
      if (synchronized) await refreshWorkspace();
    } finally {
      syncingRef.current = false;
    }
  }

  useEffect(() => {
    void (async () => {
      // Opening the app retries anything the server rejected earlier; there is no manual sync screen.
      const stored = await listFieldMutations(session.user.id).catch(() => []);
      await Promise.all(stored.filter((item) => item.status === 'needs_attention').map((item) => saveFieldMutation({ ...item, status: 'pending', error: undefined })));
      await reloadMutations().catch((error) => setNotice(errorMessage(error, 'Saved field work could not be opened.')));
      await refreshWorkspace();
      setLoading(false);
      if (navigator.onLine) void syncQueue();
    })();
  }, []);

  useEffect(() => {
    let flashTimer = 0;
    const updateStatus = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      window.clearTimeout(flashTimer);
      setNetFlash(connected ? 'back' : 'offline');
      if (connected) { flashTimer = window.setTimeout(() => setNetFlash(null), 2500); void syncQueue(); }
    };
    // Background loop: send queued work, then quietly pull new cases and notifications.
    const autoSync = window.setInterval(() => {
      if (!navigator.onLine) return;
      void syncQueue().then(() => api.workspace(session.token)).then((next) => { setWorkspace(next); return saveFieldWorkspace(session.user.id, next); }).catch(() => undefined);
    }, AUTO_SYNC_MS);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => { window.removeEventListener('online', updateStatus); window.removeEventListener('offline', updateStatus); window.clearInterval(autoSync); window.clearTimeout(flashTimer); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNoticeState(null), notice.ok ? 2200 : 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Greeting pops up on the first open of the day only.
  useEffect(() => {
    const key = `handoff-greeted:${session.user.id}`;
    const today = new Date().toDateString();
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { return; }
    const hour = new Date().getHours();
    setGreeting(`${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${session.user.name.split(' ')[0]}`);
  }, [session.user.id, session.user.name]);

  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(() => setGreeting(null), 1800);
    return () => window.clearTimeout(timer);
  }, [greeting]);

  useEffect(() => {
    if (!selectedId) { setDraftReady(false); return; }
    let active = true;
    setDraftReady(false);
    setStep('work');
    setEvidence([]);
    setPendingFiles([]);
    void (async () => {
      let stored = await loadFieldDraft<FieldDraft>(session.user.id, selectedId);
      const legacy = localStorage.getItem(legacyDraftKey(session.user.id, selectedId));
      if (!stored && legacy) {
        try { stored = JSON.parse(legacy) as FieldDraft; } catch { stored = null; }
        if (stored) await saveFieldDraft(session.user.id, selectedId, stored);
        localStorage.removeItem(legacyDraftKey(session.user.id, selectedId));
      }
      if (!active) return;
      setDraft({ ...createDraft(), ...stored, customNote: stored?.customNote ?? (stored as FieldDraft & { note?: string } | null)?.note ?? '' });
      setDraftReady(true);
      if (navigator.onLine) api.evidence(session.token, selectedId).then(({ evidence: records }) => { if (active) setEvidence(records); }).catch(() => undefined);
    })().catch((error) => setNotice(errorMessage(error, 'The saved draft could not be opened.')));
    return () => { active = false; };
  }, [selectedId, session.token, session.user.id]);

  useEffect(() => {
    if (selectedId && draftReady) void saveFieldDraft(session.user.id, selectedId, draft).catch(() => setNotice('This draft could not be saved on the device.'));
  }, [draft, draftReady, selectedId, session.user.id]);

  const unreadCount = workspace.notifications.filter((item) => !item.read).length;
  const needsAttention = mutations.filter((item) => item.status === 'needs_attention').length;
  const inspectionComplete = useMemo(() => agentChecklist.every((item) => Boolean(draft.inspection[item])), [draft.inspection]);
  const vehicleMatches = selected && normalise(draft.registration) === normalise(selected.vehicle.registration) && normalise(draft.chassisLastSix) === normalise(selected.vehicle.chassis.slice(-6));
  const selectedMutations = mutations.filter((item) => item.caseId === selectedId);
  const selectedEvidence = filterCaseEvidence(evidence, selectedId);
  const evidenceQueued = selectedMutations.some((item) => item.operation === 'evidence' && item.status !== 'needs_attention');
  const evidenceReady = selectedEvidence.length > 0 || evidenceQueued;
  const finalQueued = selectedMutations.some((item) => item.operation === 'attempt' || item.operation === 'custody');
  const authorityApproved = Boolean(selected?.authority);
  const canFinishCustody = Boolean(vehicleMatches && draft.verified && draft.location && evidenceReady && inspectionComplete && draft.yardName.trim() && draft.arrivalTime && Number(draft.parkingRate) >= 0 && draft.handoverConfirmed);

  function updateDraft(changes: Partial<FieldDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  async function captureLocation() {
    setWorking(true);
    try {
      updateDraft({ location: await readDeviceLocation() });
      setNotice('Live location captured for this work order.');
    } catch (error) { setNotice(errorMessage(error, 'Location was not captured.')); } finally { setWorking(false); }
  }

  function selectEvidence(files: File[]) {
    const validationError = validateEvidenceFiles(files);
    if (validationError) { setPendingFiles([]); setNotice(validationError); return; }
    setPendingFiles(files);
  }

  async function queueEvidence() {
    if (!selected) return;
    const validationError = validateEvidenceFiles(pendingFiles);
    if (validationError) { setNotice(validationError); return; }
    setWorking(true);
    const mutationId = `m-${crypto.randomUUID()}`;
    const blobIds: string[] = [];
    const capturedAt = new Date().toISOString();
    try {
      for (const file of pendingFiles) {
        const id = `b-${crypto.randomUUID()}`;
        blobIds.push(id);
        await saveEvidenceBlob({ id, userId: session.user.id, caseId: selected.id, name: file.name, type: file.type, capturedAt, location: draft.location, blob: file });
      }
      const mutation: StoredFieldMutation = { id: mutationId, userId: session.user.id, caseId: selected.id, operation: 'evidence', status: 'pending', dependencyIds: [], createdAt: capturedAt, attemptCount: 0, payload: { blobIds, capturedAt, location: draft.location } };
      await saveFieldMutation(mutation);
      setMutations((current) => [...current, mutation]);
      setPendingFiles([]);
      setStep('custody');
      setNotice(online ? 'Evidence saved on this device and ready to upload.' : 'Evidence queued safely on this device until you reconnect.');
      if (online) void syncQueue();
    } catch (error) {
      await deleteEvidenceBlobs(blobIds).catch(() => undefined);
      setNotice(errorMessage(error, 'Evidence could not be saved on this device.'));
    } finally { setWorking(false); }
  }

  async function queueAttempt(reason: AttemptReason, note: string) {
    if (!selected || !note.trim()) return;
    setWorking(true);
    try {
      const mutation: StoredFieldMutation = { id: `m-${crypto.randomUUID()}`, userId: session.user.id, caseId: selected.id, operation: 'attempt', status: 'pending', dependencyIds: [], createdAt: new Date().toISOString(), attemptCount: 0, payload: { reason, note: note.trim(), location: draft.location } };
      await saveFieldMutation(mutation);
      setMutations((current) => [...current, mutation]);
      setShowAttempt(false);
      setSelectedId(null);
      setNotice(online ? 'Field update saved and ready to send.' : 'Field update queued safely until you reconnect.');
      if (online) void syncQueue();
    } catch (error) { setNotice(errorMessage(error, 'The field update could not be saved.')); } finally { setWorking(false); }
  }

  async function queueCustody() {
    if (!selected || !canFinishCustody || !draft.location) return;
    setWorking(true);
    try {
      const currentQueue = await listFieldMutations(session.user.id);
      const dependencyIds = currentQueue.filter((item) => item.caseId === selected.id && item.operation === 'evidence').map((item) => item.id);
      const arrival = new Date(draft.arrivalTime);
      if (Number.isNaN(arrival.getTime())) throw new Error('Enter a valid vehicle arrival time.');
      const values = {
        yardName: draft.yardName.trim(), arrivalTime: arrival.toISOString(), parkingRate: Number(draft.parkingRate), checklist: agentChecklist.length,
        inspection: draft.inspection, customNote: draft.customNote.trim(), latitude: draft.location.latitude, longitude: draft.location.longitude,
      };
      const mutation: StoredFieldMutation = { id: `m-${crypto.randomUUID()}`, userId: session.user.id, caseId: selected.id, operation: 'custody', status: 'pending', dependencyIds, createdAt: new Date().toISOString(), attemptCount: 0, payload: { values } };
      await saveFieldMutation(mutation);
      setMutations((current) => [...current, mutation]);
      setSelectedId(null);
      setNotice(online ? 'Custody certificate saved and ready to send.' : 'Custody certificate queued safely until you reconnect.');
      if (online) void syncQueue();
    } catch (error) { setNotice(errorMessage(error, 'Custody certificate could not be saved.')); } finally { setWorking(false); }
  }

  async function clearNotifications() {
    if (!online) { setNotice('Reconnect before clearing notifications.'); return; }
    try {
      await api.readNotifications(session.token);
      const next = { ...workspace, notifications: [] };
      setWorkspace(next);
      await saveFieldWorkspace(session.user.id, next);
    } catch (error) { setNotice(errorMessage(error, 'Notifications could not be updated.')); }
  }

  const verifications = workspace.verifications ?? [];
  const openOffers = workspace.openOffers ?? [];

  // Accepting is decided by the server (first agent wins), so it needs a connection.
  async function acceptOffer(caseId: string) {
    if (!online) { setNotice('Connect to the internet to accept an open case.'); return; }
    setWorking(true);
    try {
      await api.acceptOffer(session.token, caseId);
      setNotice('Case accepted', true);
    } catch (error) {
      setNotice(errorMessage(error, 'The case could not be accepted.'));
    } finally {
      setAcceptingId(null); setWorking(false);
      await refreshWorkspace();
    }
  }
  // Every notification goes somewhere: an assigned case opens, an open offer jumps to its Accept button.
  function openNotification(item: Workspace['notifications'][number]) {
    // Older offer notices carry no case id, so fall back to the registration in the text.
    const assigned = assignments.find((entry) => entry.id === item.caseId || (!item.caseId && item.detail.includes(entry.vehicle.registration)));
    if (assigned && item.title.startsWith('New message')) { setView('messages'); setChatCaseId(assigned.id); return; }
    if (assigned) { setView('active'); setSelectedId(assigned.id); return; }
    const verification = verifications.find((entry) => entry.id === item.caseId);
    if (verification) { setSelectedVerificationId(verification.id); return; }
    const offer = openOffers.find((entry) => entry.id === item.caseId || item.detail.includes(entry.vehicle.registration));
    setView('active');
    if (offer) setAcceptingId(offer.id);
    else if (item.title === 'Open case available') setNotice('This case is no longer open. Another agent may have accepted it.');
  }

  const overlays = <>
    {notice && <div className={`field-toast ${notice.ok ? 'ok' : ''}`} role="status" onClick={() => setNotice(null)}>{notice.ok && <Check size={16} />}<span>{notice.text}</span></div>}
    {greeting && <div className="field-greeting-pop" role="status">{greeting}</div>}
    <div className={`field-net ${netFlash ?? ''}`} role="status">{netFlash === 'offline' ? <span className="sr-only">You are offline. Work stays on this phone.</span> : netFlash === 'back' ? <span className="sr-only">Back online.</span> : null}</div>
  </>;

  const selectedVerification = verifications.find((item) => item.id === selectedVerificationId) ?? null;
  if (selectedVerification) {
    return <main className="field-app"><FieldHeader title={selectedVerification.id} onBack={() => setSelectedVerificationId(null)} />
      <section className="field-case">
        <FieldVerification request={selectedVerification} userId={session.user.id} online={online} queued={mutations.some((item) => item.caseId === selectedVerification.id)} onNotice={setNotice}
          onQueued={(mutation) => { setMutations((current) => [...current, mutation]); if (online) void syncQueue(); }} />
      </section>{overlays}
    </main>;
  }

  if (selected) {
    const serverSubmitted = filterAgentCases([selected], 'submitted').length > 0;
    const readOnly = serverSubmitted || finalQueued;
    return <main className="field-app"><FieldHeader title={selected.id} onBack={() => setSelectedId(null)} action={<button onClick={() => { setSelectedId(null); setView('messages'); setChatCaseId(selected.id); }} aria-label="Message finance"><MessageSquare size={19} /></button>} />
      <section className="field-case">
        <div className="field-status"><span>{readOnly ? finalQueued ? 'SENDING' : 'REPORT SUBMITTED' : 'FINANCE ASSIGNED'}</span><small>Updated {new Date(selected.updatedAt).toLocaleString()}</small></div>
        <div className="field-vehicle-head"><span>{selected.vehicle.type === '2-wheeler' ? '2W' : '4W'}</span><div><h1>{selected.vehicle.registration}</h1><p>{selected.agentVisibility?.vehicle === false ? 'Vehicle details hidden by financer' : selected.vehicle.makeModel}</p></div></div>
        {selected.finance && <section className="field-info-card"><p className="field-label">Finance company</p><div className="field-person"><strong>{selected.finance.company}</strong><span>{selected.finance.contactName ?? 'Finance team'}{selected.finance.contactMobile ? ` · ${selected.finance.contactMobile}` : ''}</span></div>{selected.finance.contactMobile && <div className="field-quick-actions"><a href={`tel:${selected.finance.contactMobile.replaceAll(' ', '')}`}><Phone size={15} /> Call financer</a></div>}</section>}
        {selected.agentVisibility?.customer === false
          ? <section className="field-info-card"><p className="field-label">Customer and loan information</p><div className="field-person"><strong>{selected.borrower.name}</strong><span>Contact, address and loan details are hidden by the financer. Call the financer for directions.</span></div>{selected.agentVisibility?.vehicle !== false && <div className="field-loan-grid"><span><small>Chassis no.</small><strong>{selected.vehicle.chassis.slice(-8)}</strong></span></div>}</section>
          : <section className="field-info-card"><p className="field-label">Customer and loan information</p><div className="field-person"><strong>{selected.borrower.name}</strong><span>{selected.borrower.mobile}</span></div><p className="field-address"><MapPinned size={15} /> {selected.borrower.address}</p><div className="field-loan-grid"><span><small>Account</small><strong>{selected.accountNumber}</strong></span><span><small>Pending amount</small><strong>₹{selected.pendingAmount.toLocaleString('en-IN')}</strong></span><span><small>Overdue</small><strong>{selected.overdueDays} days</strong></span><span><small>Chassis no.</small><strong>{selected.agentVisibility?.vehicle === false ? 'Hidden' : selected.vehicle.chassis.slice(-8)}</strong></span></div><div className="field-quick-actions"><a href={`tel:${selected.borrower.mobile.replaceAll(' ', '')}`}><Phone size={15} /> Call customer</a><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.borrower.address)}`} target="_blank" rel="noreferrer"><MapPinned size={15} /> Open address</a></div></section>}
        {selected.assignmentNote && <section className="field-instruction"><ShieldAlert size={16} /><div><strong>Finance instruction</strong><p>{selected.assignmentNote}</p></div></section>}
        <section className={`field-authority ${authorityApproved ? 'approved' : 'missing'}`}><ShieldAlert size={17} /><div><strong>{authorityApproved ? 'Recovery authority approved' : 'Recovery authority unavailable'}</strong><p>{selected.authority ? `${selected.authority.documentName} · ${new Date(selected.authority.approvedAt).toLocaleString()}` : 'Stop and contact the finance manager. Verification cannot begin without approved authority.'}</p></div></section>
        {readOnly ? <section className="field-complete-card"><FileCheck2 size={24} /><div><strong>{finalQueued ? 'Field report saved on this device' : 'Field report already submitted'}</strong><p>{finalQueued ? 'It sends automatically as soon as the phone is online. Do not create a duplicate report.' : `Finance status: ${caseStatusLabel(selected.status)}. No further field action is available.`}</p></div></section> : <>
          <FieldSteps step={step} verified={draft.verified} evidenceReady={evidenceReady} onChange={setStep} />
          {step === 'work' && <section className="field-step-card"><div className="field-guardrail"><ShieldAlert size={19} /><div><strong>Stop conditions</strong><p>Do not use force or proceed when vehicle details differ, authority is invalid, or the situation is unsafe.</p></div></div><button className="field-primary" disabled={!authorityApproved} onClick={() => setStep('verify')}><ClipboardCheck size={18} /> Start verification</button><button className="field-secondary" onClick={() => setShowAttempt(true)}><CircleAlert size={17} /> Unable to recover</button></section>}
          {step === 'verify' && <section className="field-step-card"><StepHeading eyebrow="STEP 1 OF 3" title="Verify the vehicle" copy="Match the vehicle to the finance work order before taking custody." /><label className="field-text-label">Registration number<input autoCapitalize="characters" value={draft.registration} onChange={(event) => updateDraft({ registration: event.target.value, verified: false })} placeholder="Enter vehicle number" /></label><label className="field-text-label">Last 6 characters of chassis number<input autoCapitalize="characters" value={draft.chassisLastSix} onChange={(event) => updateDraft({ chassisLastSix: event.target.value, verified: false })} placeholder="Enter last 6 characters" /></label><div className={`field-match ${vehicleMatches ? 'confirmed' : ''}`} role="status"><Check size={17} /><span>{vehicleMatches ? 'Vehicle details match the work order.' : 'Enter both values exactly as shown on the vehicle.'}</span></div><button className="field-location" onClick={captureLocation} disabled={working}><Crosshair size={18} /><span>{draft.location ? `Location captured · ${draft.location.latitude.toFixed(5)}, ${draft.location.longitude.toFixed(5)}` : 'Capture current GPS location'}</span></button><button className="field-primary" disabled={!vehicleMatches || !draft.location} onClick={() => { updateDraft({ verified: true }); setStep('evidence'); }}><Check size={18} /> Confirm and continue</button></section>}
          {step === 'evidence' && <section className="field-step-card">
            <StepHeading eyebrow="STEP 2 OF 3" title="Capture custody evidence" copy="Take clear photos or a short video. Files are saved on this device before upload." />
            <label className="field-file-picker"><Camera size={22} /><strong>Take photos or choose files</strong><span>Up to 5 files · 15 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" capture="environment" multiple onChange={(event) => selectEvidence(Array.from(event.target.files ?? []))} /></label>
            {pendingFiles.length > 0 && <div className="field-file-list">{pendingFiles.map((file, index) => <div className="field-file-row" key={`${file.name}-${file.lastModified}`}><span><Camera size={14} /> {file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setPendingFiles((current) => removeEvidenceFile(current, index))}><X size={16} /></button></div>)}</div>}
            <button className="field-secondary field-upload" disabled={!pendingFiles.length || working} onClick={queueEvidence}><Upload size={17} /> {working ? 'Saving evidence…' : online ? 'Save and upload evidence' : 'Save evidence for later'}</button>
            <div className="field-evidence-count"><Cloud size={17} /><span><strong>{selectedEvidence.length} uploaded · {selectedMutations.filter((item) => item.operation === 'evidence').length} queued</strong><small>Queued files remain on this device until safely uploaded.</small></span></div>
            <button className="field-primary" disabled={!evidenceReady} onClick={() => setStep('custody')}><ChevronRight size={18} /> Continue to check slip</button>
          </section>}
          {step === 'custody' && <section className="field-step-card"><StepHeading eyebrow="STEP 3 OF 3" title="Digital parking check slip" copy="Record the vehicle condition and handover. Every condition needs a selection." /><div className="field-checklist-select">{agentChecklist.map((item) => <label key={item}><span>{item}</span><select value={draft.inspection[item] ?? ''} onChange={(event) => updateDraft({ inspection: { ...draft.inspection, [item]: event.target.value } })}>{inspectionOptions.map((option) => <option key={option} value={option}>{option || 'Select condition'}</option>)}</select></label>)}</div><label className="field-text-label">Parking location<input value={draft.yardName} onChange={(event) => updateDraft({ yardName: event.target.value })} placeholder="Enter yard or parking location" /></label><label className="field-text-label">Vehicle arrival time<input type="datetime-local" value={draft.arrivalTime} onChange={(event) => updateDraft({ arrivalTime: event.target.value })} /></label><label className="field-text-label">Daily parking rate (₹)<input type="number" min="0" inputMode="numeric" value={draft.parkingRate} onChange={(event) => updateDraft({ parkingRate: event.target.value })} placeholder="e.g. 350" /></label><label className="field-text-label">Custom note (optional)<textarea maxLength={2000} value={draft.customNote} onChange={(event) => updateDraft({ customNote: event.target.value })} placeholder="Visible damage, handover notes, or other factual details…" /></label><label className="field-confirm"><input type="checkbox" checked={draft.handoverConfirmed} onChange={(event) => updateDraft({ handoverConfirmed: event.target.checked })} /><span>I confirm this inspection reflects the vehicle at handover.</span></label><button className="field-primary" disabled={!canFinishCustody || working} onClick={queueCustody}><Check size={18} /> {working ? 'Saving custody…' : online ? 'Save and submit custody' : 'Save custody for later'}</button><p className="field-draft-note"><Save size={14} /> Draft and queued work stay on this phone until synchronization succeeds.</p></section>}
        </>}
      </section>{overlays}{showAttempt && <FailedAttemptDialog onClose={() => setShowAttempt(false)} onSave={queueAttempt} busy={working} />}
    </main>;
  }

  if (view === 'notifications') return <main className="field-app"><FieldHeader title="NOTIFICATIONS" onBack={() => setView('active')} action={<button className="field-header-text" disabled={!workspace.notifications.length} onClick={clearNotifications}>Clear all</button>} />
    <section className="field-home">
      <section className="field-list">{workspace.notifications.length ? workspace.notifications.map((item) => <button key={item.id} className={`field-list-row ${item.read ? '' : 'unread'}`} onClick={() => openNotification(item)}><Bell size={18} /><span><strong>{item.title}</strong><small>{item.detail}</small><em>{new Date(item.createdAt).toLocaleString()}</em></span><ChevronRight size={17} /></button>) : <p className="field-empty">You're all caught up.</p>}</section>
    </section>{overlays}
  </main>;

  const chatCase = chatCaseId ? assignments.find((item) => item.id === chatCaseId) : undefined;
  if (view === 'messages' && chatCase) return <main className="field-app chat-screen"><FieldHeader title={chatCase.finance?.company ?? chatCase.id} onBack={() => setChatCaseId(null)} />
    <ChatThread token={session.token} caseId={chatCase.id} userId={session.user.id} online={online} onError={setNotice} />{overlays}
  </main>;

  const tab = view as Exclude<FieldView, 'notifications'>;
  const activeCases = filterAgentCases(assignments, 'active');
  const submittedCases = filterAgentCases(assignments, 'submitted');
  const activeVerifications = verifications.filter((item) => item.status !== 'submitted');
  const doneVerifications = verifications.filter((item) => item.status === 'submitted');
  const titles = { active: 'Active', submitted: 'Submitted', messages: 'Messages', profile: 'Profile' };
  const verificationRow = (item: typeof verifications[number]) => <button key={item.id} className="field-list-row" onClick={() => setSelectedVerificationId(item.id)}><MapPinned size={18} /><span><strong>{item.customer.name} · {item.customer.city}</strong><small>{item.reference} · {item.finance?.company ?? 'Finance company'}</small><em>{item.status === 'submitted' ? (item.result === 'verified' ? 'Submitted · verified' : 'Submitted · not verified') : mutations.some((mutation) => mutation.caseId === item.id) ? 'Saved on phone · sending' : 'To visit'}</em></span><ChevronRight size={17} /></button>;
  const caseCards = (items: RecoveryCase[], submitted: boolean) => items.map((item) => <AssignmentCard key={item.id} item={item} submitted={submitted} queued={mutations.some((mutation) => mutation.caseId === item.id)} onOpen={() => setSelectedId(item.id)} />);

  return <main className="field-app has-nav">
    <header className="field-topbar"><img src="/handoff-logo.png" alt="Handoff" /><button onClick={() => setView('notifications')} aria-label={`${unreadCount} unread notifications`}><Bell size={21} />{unreadCount > 0 && <i>{unreadCount > 9 ? '9+' : unreadCount}</i>}</button></header>
    <section className="field-home">
      {tab !== 'profile' && <div className="field-title-row"><h1>{titles[tab]}</h1>{tab !== 'messages' && <div className="field-kpis"><span className={tab === 'active' ? 'on' : ''}>{activeCases.length + activeVerifications.length} active</span><span className={tab === 'submitted' ? 'on' : ''}>{submittedCases.length + doneVerifications.length} done</span>{needsAttention > 0 && <span className="warn">{needsAttention} stuck</span>}</div>}</div>}
      {loading && tab !== 'profile' ? <p className="field-empty">Loading your work…</p> : <>
        {tab === 'active' && <>
          {openOffers.length > 0 && <section className="field-list"><p className="field-label">Open cases · first agent to accept gets it</p>{openOffers.map((offer) => <article key={offer.id} className={`field-list-row offer-row ${acceptingId === offer.id ? 'highlight' : ''}`}><CarFront size={18} /><span><strong>{offer.vehicle.registration}{offer.vehicle.makeModel ? ` · ${offer.vehicle.makeModel}` : ''}</strong><small>{offer.financeCompany} · {offer.branch}</small><em>Offered {new Date(offer.offeredAt).toLocaleString()}</em></span>{acceptingId === offer.id ? <span className="offer-confirm"><button className="field-primary" disabled={working} onClick={() => acceptOffer(offer.id)}>Confirm</button><button className="field-secondary" onClick={() => setAcceptingId(null)}>Cancel</button></span> : <button className="field-primary" disabled={working} onClick={() => setAcceptingId(offer.id)}>Accept</button>}</article>)}</section>}
          {activeVerifications.length > 0 && <section className="field-list"><p className="field-label">House verifications</p>{activeVerifications.map(verificationRow)}</section>}
          <section className="assignment-cards">{activeCases.length ? caseCards(activeCases, false) : !openOffers.length && !activeVerifications.length && <p className="field-empty">No active work right now.</p>}</section>
        </>}
        {tab === 'submitted' && <>
          {doneVerifications.length > 0 && <section className="field-list"><p className="field-label">House verifications</p>{doneVerifications.map(verificationRow)}</section>}
          <section className="assignment-cards">{submittedCases.length ? caseCards(submittedCases, true) : !doneVerifications.length && <p className="field-empty">Nothing submitted yet.</p>}</section>
        </>}
        {tab === 'messages' && <ChatList cases={assignments} onOpen={setChatCaseId} />}
      </>}
      {tab === 'profile' && <FieldProfile session={session} onSaved={onSessionUpdate} onNotice={setNotice} onLogout={onRequestSignOut} />}
    </section>
    <nav className="field-nav" aria-label="Sections">
      {([['submitted', CheckCheck, 'Submitted'], ['active', CarFront, 'Active'], ['messages', MessageSquare, 'Messages'], ['profile', UserRound, 'Profile']] as const).map(([id, Icon, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setView(id); setChatCaseId(null); }}>{id === 'profile' && session.user.profile?.avatar ? <Avatar src={session.user.profile.avatar} size={24} /> : <Icon size={21} />}<span>{label}</span></button>)}
    </nav>{overlays}
  </main>;
}

function FieldHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
  return <header className="field-header"><button onClick={onBack} aria-label="Go back"><ArrowLeft size={20} /></button><div><span>FIELD AGENT</span><strong>{title}</strong></div>{action ?? <span className="field-header-spacer" />}</header>;
}

function AssignmentCard({ item, submitted, queued, onOpen }: { item: RecoveryCase; submitted: boolean; queued: boolean; onOpen: () => void }) {
  return <button className="field-assignment" onClick={onOpen}><div><span className={`field-case-icon ${item.vehicle.type === '2-wheeler' ? 'bike' : ''}`}><CarFront size={17} /></span><div><p>{item.id}</p><h2>{item.vehicle.registration}</h2><small>{item.vehicle.makeModel}</small></div><ChevronRight size={18} /></div><section><span className={`field-tag ${submitted ? 'complete' : queued ? 'warning' : ''}`}>{queued ? 'UPDATE QUEUED' : submitted ? 'REPORT SUBMITTED' : 'READY TO START'}</span><p>{item.borrower.name} · {item.borrower.address}</p></section></button>;
}

function StepHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="field-step-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function FieldSteps({ step, verified, evidenceReady, onChange }: { step: FieldStep; verified: boolean; evidenceReady: boolean; onChange: (step: FieldStep) => void }) {
  const items: Array<{ id: 'verify' | 'evidence' | 'custody'; label: string; number: number }> = [{ id: 'verify', label: 'Verify', number: 1 }, { id: 'evidence', label: 'Evidence', number: 2 }, { id: 'custody', label: 'Check slip', number: 3 }];
  return <nav className="field-steps" aria-label="Recovery progress">{items.map((item) => { const enabled = canOpenFieldStep(item.id, { verified, evidenceReady }); return <button key={item.id} disabled={!enabled} className={step === item.id ? 'active' : ''} onClick={() => enabled && onChange(item.id)}><span>{item.id === 'evidence' && evidenceReady ? <Check size={13} /> : item.number}</span>{item.label}</button>; })}</nav>;
}

function FailedAttemptDialog({ onClose, onSave, busy }: { onClose: () => void; onSave: (reason: AttemptReason, note: string) => void; busy: boolean }) {
  const [reason, setReason] = useState<AttemptReason>('Vehicle not found');
  const [note, setNote] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); previous?.focus(); };
  }, [onClose]);
  return <div className="field-modal-backdrop"><section className="field-modal" role="dialog" aria-modal="true" aria-labelledby="failed-attempt-title"><div className="field-modal-top"><div><span>FIELD UPDATE</span><h2 id="failed-attempt-title">Unable to recover</h2></div><button onClick={onClose} aria-label="Close unable-to-recover form" autoFocus><X size={19} /></button></div><p>Select the most accurate reason and add a factual note for the finance team.</p><div className="field-reason-list">{reasonOptions.map((item) => <label key={item}><input type="radio" checked={reason === item} onChange={() => setReason(item)} /><span>{item}</span></label>)}</div><label className="field-text-label">Required factual note<textarea required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add what happened during this attempt…" /></label><button disabled={busy || !note.trim()} className="field-primary" onClick={() => onSave(reason, note)}>{busy ? 'Saving update…' : 'Save field update'}</button></section></div>;
}

function FieldApp(props: { session: Session; onLogout: () => void; onSessionUpdate: (user: Session['user']) => void }) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  return <>
    <FieldScreens {...props} onRequestSignOut={() => setConfirmingSignOut(true)} />
    {confirmingSignOut && <div className="field-modal-backdrop"><section className="field-modal" role="dialog" aria-modal="true" aria-labelledby="sign-out-title"><div className="field-modal-top"><div><span>ACCOUNT</span><h2 id="sign-out-title">Sign out?</h2></div></div><p>You will need a new one-time code to sign in again. Work saved on this phone stays here until it syncs.</p><button className="field-primary" onClick={props.onLogout}><LogOut size={17} /> Sign out</button><button className="field-secondary" onClick={() => setConfirmingSignOut(false)}>Stay signed in</button></section></div>}
  </>;
}

export default FieldApp;
