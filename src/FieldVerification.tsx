import { useState } from 'react';
import { Camera, Check, Crosshair, FileCheck2, MapPinned, Phone, ShieldAlert, Upload, X } from 'lucide-react';
import { deleteEvidenceBlobs, saveEvidenceBlob, saveFieldMutation } from './field-offline';
import type { StoredFieldMutation } from './field-offline';
import { removeEvidenceFile, validateVerificationPhotos } from './field-workflow';
import { readDeviceLocation } from './device-location';
import type { FieldLocation } from './device-location';
import type { VerificationRequest } from './types';

type Props = {
  request: VerificationRequest;
  userId: string;
  online: boolean;
  queued: boolean;
  onNotice: (message: string) => void;
  onQueued: (mutation: StoredFieldMutation) => void;
};

// Agent flow for a house verification: go to the address, capture GPS, take 2-4 photos, record the result.
// Saved on the device first and sent by the same offline queue as vehicle evidence.
function FieldVerification({ request, userId, online, queued, onNotice, onQueued }: Props) {
  const [location, setLocation] = useState<FieldLocation | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [result, setResult] = useState<'verified' | 'not_verified' | ''>('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const photoError = photos.length ? validateVerificationPhotos(photos) : null;
  const ready = Boolean(location && photos.length && !photoError && result && note.trim());
  const fullAddress = [request.customer.address, request.customer.landmark, request.customer.city, request.customer.pincode].filter(Boolean).join(', ');

  async function capture() {
    setWorking(true);
    try { setLocation(await readDeviceLocation()); onNotice('Location captured at the customer address.'); } catch (error) { onNotice(error instanceof Error ? error.message : 'Location was not captured.'); } finally { setWorking(false); }
  }

  async function submit() {
    if (!ready || !location || !result) return;
    setWorking(true);
    const capturedAt = new Date().toISOString();
    const blobIds: string[] = [];
    try {
      for (const file of photos) {
        const id = `b-${crypto.randomUUID()}`;
        blobIds.push(id);
        await saveEvidenceBlob({ id, userId, caseId: request.id, name: file.name, type: file.type, capturedAt, location, blob: file });
      }
      const mutation: StoredFieldMutation = { id: `m-${crypto.randomUUID()}`, userId, caseId: request.id, operation: 'verification', status: 'pending', dependencyIds: [], createdAt: capturedAt, attemptCount: 0, payload: { blobIds, capturedAt, location, result, note: note.trim() } };
      await saveFieldMutation(mutation);
      onQueued(mutation);
      onNotice(online ? 'Verification saved and sending to the financer.' : 'Verification saved on this device until you reconnect.');
    } catch (error) {
      await deleteEvidenceBlobs(blobIds).catch(() => undefined);
      onNotice(error instanceof Error ? error.message : 'The verification could not be saved on this device.');
    } finally { setWorking(false); }
  }

  const done = request.status === 'submitted' || queued;
  return <>
    <div className="field-status"><span>{request.status === 'submitted' ? 'VERIFICATION SUBMITTED' : queued ? 'QUEUED FOR SYNC' : 'HOUSE VERIFICATION'}</span><small>Requested {new Date(request.createdAt).toLocaleString()}</small></div>
    <div className="field-vehicle-head"><span>HV</span><div><h1>{request.customer.name}</h1><p>{request.reference}</p></div></div>
    {request.finance && <section className="field-info-card"><p className="field-label">Finance company</p><div className="field-person"><strong>{request.finance.company}</strong><span>{request.finance.contactName ?? 'Finance team'}{request.finance.contactMobile ? ` · ${request.finance.contactMobile}` : ''}</span></div>{request.finance.contactMobile && <div className="field-quick-actions"><a href={`tel:${request.finance.contactMobile.replaceAll(' ', '')}`}><Phone size={15} /> Call financer</a></div>}</section>}
    <section className="field-info-card"><p className="field-label">Customer residence</p><div className="field-person"><strong>{request.customer.name}</strong><span>{request.customer.mobile}</span></div><p className="field-address"><MapPinned size={15} /> {fullAddress}</p><div className="field-quick-actions"><a href={`tel:${request.customer.mobile.replaceAll(' ', '')}`}><Phone size={15} /> Call customer</a><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noreferrer"><MapPinned size={15} /> Open address</a></div></section>
    {request.instructions && <section className="field-instruction"><ShieldAlert size={16} /><div><strong>Finance instruction</strong><p>{request.instructions}</p></div></section>}
    {done ? <section className="field-complete-card"><FileCheck2 size={24} /><div><strong>{request.status === 'submitted' ? `Submitted · ${request.result === 'verified' ? 'location verified' : 'location not verified'}` : 'Verification saved on this device'}</strong><p>{request.status === 'submitted' ? request.resultNote : 'It sends automatically as soon as the phone is online. Do not submit again.'}</p></div></section> : <section className="field-step-card">
      <p className="field-label">Verify at the address</p>
      <button className="field-location" onClick={capture} disabled={working}><Crosshair size={18} /><span>{location ? `Location captured · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Capture GPS at the customer address'}</span></button>
      <label className="field-file-picker"><Camera size={22} /><strong>Take 2 to 4 photos</strong><span>House front, name plate or door number, surroundings</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={(event) => setPhotos((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 4))} /></label>
      {photos.length > 0 && <div className="field-file-list">{photos.map((file, index) => <div className="field-file-row" key={`${file.name}-${file.lastModified}-${index}`}><span><Camera size={14} /> {file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setPhotos((current) => removeEvidenceFile(current, index))}><X size={16} /></button></div>)}</div>}
      {photoError && <p className="field-form-error" role="alert">{photoError}</p>}
      <div className="field-tabs" role="radiogroup" aria-label="Verification result"><button role="radio" aria-checked={result === 'verified'} className={result === 'verified' ? 'active' : ''} onClick={() => setResult('verified')}><Check size={15} /> Verified</button><button role="radio" aria-checked={result === 'not_verified'} className={result === 'not_verified' ? 'active' : ''} onClick={() => setResult('not_verified')}><X size={15} /> Not verified</button></div>
      <label className="field-text-label">What you found<textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Who you met, house details, neighbour confirmation, anything that did not match…" /></label>
      <button className="field-primary" disabled={!ready || working} onClick={submit}><Upload size={18} /> {working ? 'Saving…' : online ? 'Save and send to financer' : 'Save for later'}</button>
    </section>}
  </>;
}

export default FieldVerification;
