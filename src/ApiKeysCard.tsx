import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from './api';
import type { ApiKey, Session } from './api';
import { errorMessage } from './BillingPage';

// Owner-only: keys let an outside loan system push, list and cancel vehicle records.
function ApiKeysCard({ session }: { session: Session }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.apiKeys(session.token).then(({ keys: list }) => setKeys(list)).catch((cause) => setError(errorMessage(cause)));
  }, [session.token]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNewKey('');
    try {
      const { key } = await api.createApiKey(session.token, name.trim());
      setNewKey(key.key); setName('');
      setKeys((await api.apiKeys(session.token)).keys);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Systems using it stop working immediately.`)) return;
    setError('');
    try {
      await api.revokeApiKey(session.token, key.id);
      setKeys((await api.apiKeys(session.token)).keys);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const origin = window.location.origin;
  return <article className="card settings-block">
    <h3><KeyRound size={17} /> API keys</h3>
    <p className="page-copy">Let your loan software add, list and cancel vehicle records. Every accepted record is billed like an imported row.</p>
    {error && <div className="app-error" role="alert">{error}</div>}
    <form className="inline-form" onSubmit={create}><label className="field-label">Key name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} placeholder="e.g. LMS production" /></label><button className="primary-button" type="submit">Create key</button></form>
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
