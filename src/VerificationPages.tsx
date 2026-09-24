import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Camera, Check, ChevronRight, Lock, MapPin, Plus, Star, X } from 'lucide-react';
import { api } from './api';
import type { Session, VerificationInput } from './api';
import type { Agent, EvidenceRecord, VerificationRequest } from './types';
import Modal from './Modal';
import { errorMessage, rupees } from './BillingPage';
import { RatingBadge, rateText } from './CaseAgentPanel';

const statusLabel: Record<VerificationRequest['status'], string> = { open: 'Waiting for agent', assigned: 'With agent', submitted: 'Submitted', cancelled: 'Cancelled' };

function resultLabel(item: VerificationRequest) {
  if (item.status !== 'submitted') return statusLabel[item.status];
  return item.result === 'verified' ? 'Verified' : 'Not verified';
}

function monthStart() {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  return start;
}

// Finance "House verification" tab on the Requests page.
export function VerificationTab({ verifications, agents, session, onChanged }: { verifications: VerificationRequest[]; agents: Agent[]; session: Session; onChanged: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const canCreate = session.user.permissions.includes('case.create');
  const selected = verifications.find((item) => item.id === selectedId) ?? null;
  const start = monthStart();

  return <>
    <div className="page-heading"><div><p className="eyebrow">House verification</p><h2>Location verification requests</h2><p className="page-copy">An agent visits the customer's residence, captures GPS and 2 to 4 photos, and reports whether the address is correct.</p></div><div className="heading-actions">{canCreate && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> New verification request</button>}</div></div>
    {notice && <div className="app-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
    <section className="count-strip">
      <div><strong>{verifications.filter((item) => new Date(item.createdAt) >= start).length}</strong><span>Requests this month</span></div>
      <div><strong>{verifications.length}</strong><span>All requests</span></div>
      <div><strong>{verifications.filter((item) => item.status === 'open').length}</strong><span>Waiting for an agent</span></div>
      <div><strong>{verifications.filter((item) => item.status === 'submitted').length}</strong><span>Submitted</span></div>
    </section>
    <article className="card data-card"><div className="table-scroll"><table className="case-table"><thead><tr><th>Customer</th><th>City</th><th>Agent</th><th>Status</th><th>Requested</th><th /></tr></thead><tbody>{verifications.length ? verifications.map((item) => item.billingLocked
      ? <tr key={item.id} className="row-locked" aria-disabled="true" title="Locked until the wallet is recharged"><td><strong>{item.customer.name}</strong><small>{item.id} · {item.reference}</small></td><td>{item.customer.city}</td><td>—</td><td><span className="lock-badge"><Lock size={12} /> Locked</span></td><td>{new Date(item.createdAt).toLocaleDateString('en-IN')}</td><td /></tr>
      : <tr key={item.id} className="row-action" role="button" tabIndex={0} aria-label={`Open verification ${item.id}`} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id); } }}><td><strong>{item.customer.name}</strong><small>{item.id} · {item.reference}</small></td><td>{item.customer.city}</td><td>{item.assignedAgentName ?? '—'}</td><td><span className={`status-pill ${item.status === 'submitted' ? item.result === 'verified' ? 'green' : 'red' : item.status === 'assigned' ? 'blue' : 'slate'}`}><i />{resultLabel(item)}</span></td><td>{new Date(item.createdAt).toLocaleDateString('en-IN')}</td><td><ChevronRight size={17} /></td></tr>)
      : <tr><td colSpan={6}><div className="empty-table">No verification requests yet.</div></td></tr>}</tbody></table></div></article>
    {creating && <NewVerificationDialog session={session} onClose={() => setCreating(false)} onCreated={async (message) => { setCreating(false); setNotice(message); await onChanged(); }} />}
    {selected && <VerificationDrawer item={selected} agents={agents} session={session} onClose={() => setSelectedId(null)} onChanged={onChanged} />}
  </>;
}

function NewVerificationDialog({ session, onClose, onCreated }: { session: Session; onClose: () => void; onCreated: (message: string) => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(['reference', 'customerName', 'customerMobile', 'address', 'landmark', 'city', 'pincode', 'instructions'].map((key) => [key, String(form.get(key) || '')])) as unknown as VerificationInput;
    setBusy(true); setError('');
    try {
      const { verification, billing } = await api.createVerification(session.token, values);
      await onCreated(billing.pending ? `${verification.id} was created but is locked until your wallet is recharged.` : `${verification.id} was created and billed ${rupees(billing.amountPaidPaise)}. Assign an agent to send it to the field.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return <Modal title="New house verification" onClose={onClose}><form onSubmit={submit}>
    <p className="modal-copy">Enter the residence the agent must visit. The platform fee is charged when the request is created and is not refunded.</p>
    <div className="form-two-col"><label className="field-label">Application / loan reference<input name="reference" required maxLength={100} /></label><label className="field-label">Customer name<input name="customerName" required minLength={2} maxLength={255} /></label><label className="field-label">Customer mobile<input name="customerMobile" type="tel" required /></label><label className="field-label">City<input name="city" required minLength={2} maxLength={191} /></label></div>
    <label className="field-label">Residential address<textarea name="address" required minLength={5} maxLength={1000} /></label>
    <div className="form-two-col"><label className="field-label">Landmark (optional)<input name="landmark" maxLength={255} /></label><label className="field-label">PIN code (optional)<input name="pincode" inputMode="numeric" pattern="\d{6}" maxLength={6} /></label></div>
    <label className="field-label">Instructions for the agent (optional)<textarea name="instructions" maxLength={2000} placeholder="What to check: name plate, ownership, neighbours, how long the customer has lived there…" /></label>
    {error && <div className="app-error" role="alert">{error}</div>}
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={busy}><Check size={15} /> Create request</button></div>
  </form></Modal>;
}

function VerificationDrawer({ item, agents, session, onClose, onChanged }: { item: VerificationRequest; agents: Agent[]; session: Session; onClose: () => void; onChanged: () => Promise<void> }) {
  const activeAgents = agents.filter((agent) => agent.status === 'Active').sort((a, b) => (a.rates?.verification ?? Infinity) - (b.rates?.verification ?? Infinity));
  const [agentId, setAgentId] = useState(item.assignedAgentId ?? '');
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canAssign = session.user.permissions.includes('case.assign');
  const chosen = activeAgents.find((agent) => agent.id === agentId);
  const agentRate = item.status === 'open' || item.status === 'assigned' ? chosen?.rates?.verification ?? null : item.agentRate;

  useEffect(() => {
    if (item.status !== 'submitted') return;
    api.verificationEvidence(session.token, item.id).then(({ evidence: records }) => setEvidence(records)).catch((cause) => setError(errorMessage(cause)));
  }, [item.id, item.status, session.token]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await onChanged(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  async function openPhoto(record: EvidenceRecord) {
    try { setPhotoUrl(URL.createObjectURL(await api.verificationPhoto(session.token, record.id))); } catch (cause) { setError(errorMessage(cause)); }
  }

  const cancel = () => { if (window.confirm('Cancel this verification request? The platform fee is not refunded.')) void run(() => api.cancelVerification(session.token, item.id)); };

  return <><div className="drawer-backdrop" onClick={onClose} /><aside className="case-drawer" role="dialog" aria-modal="true" aria-labelledby="verification-drawer-title">
    <div className="drawer-top"><div><p className="eyebrow">{item.id} · {item.reference}</p><h2 id="verification-drawer-title">{item.customer.name}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Close verification details"><X size={18} /></button></div>
    <span className={`status-pill ${item.status === 'submitted' ? item.result === 'verified' ? 'green' : 'red' : item.status === 'assigned' ? 'blue' : 'slate'}`}><i />{resultLabel(item)}</span>
    <div className="drawer-section"><p className="section-label">Residence to verify</p><p><strong>{item.customer.mobile}</strong></p><p>{[item.customer.address, item.customer.landmark, item.customer.city, item.customer.pincode].filter(Boolean).join(', ')}</p>{item.instructions && <p className="custody-agent-note"><strong>Instructions</strong>{item.instructions}</p>}</div>

    {canAssign && (item.status === 'open' || item.status === 'assigned') && <div className="drawer-section"><p className="section-label">{item.status === 'open' ? 'Assign an agent' : 'Reassign'}</p>
      {activeAgents.length ? <div className="assign-agent-list">{activeAgents.map((agent) => <label key={agent.id} className="assign-agent-row"><input type="radio" name="verification-agent" checked={agentId === agent.id} onChange={() => setAgentId(agent.id)} /><span><strong>{agent.name} <RatingBadge rating={agent.rating} /></strong><small>{agent.city} · {rateText(agent.rates, 'verification')}</small></span></label>)}</div> : <p className="field-hint">Add agents to your roster first.</p>}
      <div className="cost-summary"><span>Platform fee <strong>{rupees(item.platformFee * 100)}</strong> (already billed)</span><span>Agent rate <strong>{agentRate === null ? 'not set' : rupees(agentRate * 100)}</strong> (pay the agent directly)</span><span>Total cost <strong>{rupees((item.platformFee + (agentRate ?? 0)) * 100)}</strong></span></div>
      <div className="drawer-actions"><button className="primary-button" disabled={!agentId || busy || agentId === item.assignedAgentId} onClick={() => run(() => api.assignVerification(session.token, item.id, agentId))}>{item.status === 'open' ? 'Assign agent' : 'Reassign agent'}</button><button className="text-button danger" disabled={busy} onClick={cancel}>Cancel request</button></div>
    </div>}

    {item.status === 'submitted' && <div className="drawer-section"><p className="section-label">Agent report · {item.assignedAgentName}</p><p><strong>{item.result === 'verified' ? 'Location verified' : 'Location could not be verified'}</strong></p><p>{item.resultNote}</p><small>{item.submittedAt ? new Date(item.submittedAt).toLocaleString('en-IN') : ''}</small>
      {item.latitude != null && item.longitude != null && <p><a className="text-button maps-link" href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Open agent GPS in Maps ({item.latitude.toFixed(5)}, {item.longitude.toFixed(5)})</a></p>}
      <div className="evidence-meta"><Camera size={16} /><span>{evidence.length} photo{evidence.length === 1 ? '' : 's'}</span></div>
      {evidence.map((record) => <button className="evidence-row" key={record.id} onClick={() => openPhoto(record)}><Camera size={15} /><span><strong>{record.originalName}</strong><small>{new Date(record.capturedAt).toLocaleString('en-IN')}</small></span><ChevronRight size={15} /></button>)}
      {photoUrl && <div className="evidence-viewer"><div><strong>Photo</strong><button onClick={() => setPhotoUrl(null)} aria-label="Close photo"><X size={15} /></button></div><img src={photoUrl} alt={`Verification photo for ${item.id}`} /></div>}
    </div>}

    {item.status === 'submitted' && canAssign && item.assignedAgentId && <div className="drawer-section"><p className="section-label">Rate the agent's work</p><div className="rate-row"><span>{item.assignedAgentName}</span><span className="star-input" role="radiogroup" aria-label={`Rate ${item.assignedAgentName}`}>{[1, 2, 3, 4, 5].map((value) => <button type="button" role="radio" aria-checked={item.agentStars === value} aria-label={`${value} star${value === 1 ? '' : 's'}`} key={value} disabled={busy} className={(item.agentStars ?? 0) >= value ? 'on' : ''} onClick={() => run(() => api.rateAgent(session.token, { jobType: 'verification', jobId: item.id, agentId: item.assignedAgentId as string, stars: value }))}><Star size={16} /></button>)}</span></div></div>}

    {error && <div className="app-error" role="alert">{error}</div>}
  </aside></>;
}
