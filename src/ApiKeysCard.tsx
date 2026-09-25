import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from './api';
import type { ApiKey, ApiKeyAllowance, Session } from './api';
import { errorMessage, rupees } from './BillingPage';

// Owner-only: keys let an outside loan system push, list and cancel vehicle records.
function ApiKeysCard({ session }: { session: Session }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [allowance, setAllowance] = useState<ApiKeyAllowance | null>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    const result = await api.apiKeys(session.token);
    setKeys(result.keys); setAllowance(result.allowance);
  }

  useEffect(() => { reload().catch((cause) => setError(errorMessage(cause))); }, [session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice('');
    try {
      await api.requestApiKey(session.token, reason.trim());
      setReason(''); setNotice('Request sent. Handoff will review it; once approved the fee is charged to your wallet and you can create the key here.');
      await reload();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNewKey('');
    try {
      const { key } = await api.createApiKey(session.token, name.trim());
      setNewKey(key.key); setName('');
      await reload();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Systems using it stop working immediately.`)) return;
    setError('');
    try {
      await api.revokeApiKey(session.token, key.id);
      await reload();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const origin = window.location.origin;
  const atLimit = allowance ? allowance.active >= allowance.limit : false;
  const pendingRequest = allowance?.latestRequest?.status === 'pending' ? allowance.latestRequest : null;
  return <article className="card settings-block">
    <h3><KeyRound size={17} /> API keys</h3>
    <p className="page-copy">Let your loan software add, list and cancel vehicle records. Every accepted record is billed like an imported row.</p>
    {allowance && <p className="key-usage"><strong>{allowance.active} of {allowance.limit}</strong> API key{allowance.limit === 1 ? '' : 's'} in use. Your first key is free; each extra key needs Handoff's approval and costs {rupees(allowance.extraKeyFeePaise)}, charged to your wallet.</p>}
    {error && <div className="app-error" role="alert">{error}</div>}
    {notice && <div className="app-notice" role="status">{notice}</div>}
    {!atLimit
      ? <form className="inline-form" onSubmit={create}><label className="field-label">Key name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} placeholder="e.g. LMS production" /></label><button className="primary-button" type="submit">Create key</button></form>
      : pendingRequest
        ? <div className="key-request pending"><strong>Request for another key is waiting for approval</strong><span>“{pendingRequest.reason}” · sent {new Date(pendingRequest.createdAt).toLocaleDateString('en-IN')}</span></div>
        : <form className="key-request" onSubmit={requestKey}><strong>Need another key?</strong><label className="field-label">What is it for?<input value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={500} placeholder="e.g. A second LMS for our staging environment" /></label><button className="secondary-button" type="submit">Request another key ({allowance ? rupees(allowance.extraKeyFeePaise) : 'fee applies'})</button></form>}
    {newKey && <div className="new-key" role="status"><p><strong>Copy this key now.</strong> It is shown only once.</p><code>{newKey}</code><button className="secondary-button" type="button" onClick={() => void navigator.clipboard?.writeText(newKey)}>Copy</button></div>}
    <div className="table-scroll"><table><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>{keys.length ? keys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong><small>{key.createdBy}</small></td><td className="mono">{key.keyPrefix}…</td><td>{new Date(key.createdAt).toLocaleDateString('en-IN')}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('en-IN') : 'Never'}</td><td>{key.revokedAt ? 'Revoked' : <button className="text-button danger" onClick={() => revoke(key)}>Revoke</button>}</td></tr>) : <tr><td colSpan={5}><div className="empty-table">No API keys yet.</div></td></tr>}</tbody></table></div>
    <details className="api-docs"><summary>How to call the API</summary><pre>{`# Add or update cases (upserts by account number, max 1000 per call)
curl -X POST ${origin}/api/v1/cases \\
  -H "Authorization: Bearer hk_..." -H "Content-Type: application/json" \\
  -d '{"cases":[{"accountNumber":"LN-1001","borrowerName":"Meera Iyer","borrowerMobile":"9876543210","borrowerAddress":"HSR Layout, Bengaluru","registration":"KA01MQ4281","makeModel":"Honda Activa","vehicleType":"2W","pendingAmount":38400,"overdueDays":97}]}'

# List cases (optional ?status=imported&limit=100)
curl ${origin}/api/v1/cases -H "Authorization: Bearer hk_..."

# Remove (cancel) a case that is not yet with an agent
curl -X DELETE ${origin}/api/v1/cases/LN-1001 -H "Authorization: Bearer hk_..."`}</pre></details>
  </article>;
}

export default ApiKeysCard;
