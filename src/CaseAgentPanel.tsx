import { useState } from 'react';
import { Star } from 'lucide-react';
import { api } from './api';
import type { Session } from './api';
import type { AgentRates, AgentRating, RecoveryCase } from './types';
import { errorMessage } from './BillingPage';

// Statuses where the assigned agent has submitted a field outcome (the server re-checks from the audit trail).
const RATEABLE = new Set(['unable_to_recover', 'custody_review', 'payment_pending', 'payment_confirmed', 'release_pass_printed', 'closed']);

export function RatingBadge({ rating }: { rating?: AgentRating | null }) {
  return rating ? <span className="rating-badge" title={`${rating.count} rating${rating.count === 1 ? '' : 's'} from financers`}><Star size={12} /> {rating.average.toFixed(1)} <small>({rating.count})</small></span> : <span className="rating-badge none">No ratings yet</span>;
}

export function rateText(rates: AgentRates | undefined, kind: keyof AgentRates) {
  const value = rates?.[kind];
  return value === null || value === undefined ? 'Rate not set' : `₹${value.toLocaleString('en-IN')} per job`;
}

// Finance-only controls in the case drawer: what the agent may see, and rating agents after their outcome.
function CaseAgentPanel({ caseItem, session, onChanged }: { caseItem: RecoveryCase; session: Session; onChanged: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!session.user.permissions.includes('case.assign')) return null;
  const visibility = caseItem.agentVisibility ?? { customer: true, vehicle: true };

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await onChanged(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  const setVisibility = (next: { customer: boolean; vehicle: boolean }) => run(() => api.setAgentVisibility(session.token, caseItem.id, next));
  const rate = (agentId: string, stars: number) => run(() => api.rateAgent(session.token, { caseId: caseItem.id, agentId, stars }));

  return <>
    <div className="drawer-section"><p className="section-label">What the agent can see</p>
      <label className="check-line"><input type="checkbox" disabled={busy} checked={visibility.customer} onChange={(event) => setVisibility({ ...visibility, customer: event.target.checked })} /> Customer details (mobile, address, loan account and dues)</label>
      <label className="check-line"><input type="checkbox" disabled={busy} checked={visibility.vehicle} onChange={(event) => setVisibility({ ...visibility, vehicle: event.target.checked })} /> Vehicle details (make/model, chassis). The registration number is always shown.</label>
    </div>
    {RATEABLE.has(caseItem.status) && Boolean(caseItem.assignedAgents?.length) && <div className="drawer-section"><p className="section-label">Rate the agent's work</p>
      {caseItem.assignedAgents?.map((agent) => <div className="rate-row" key={agent.id}><span>{agent.name}</span><span className="star-input" role="radiogroup" aria-label={`Rate ${agent.name}`}>{[1, 2, 3, 4, 5].map((value) => <button type="button" role="radio" aria-checked={agent.stars === value} aria-label={`${value} star${value === 1 ? '' : 's'}`} key={value} disabled={busy} className={(agent.stars ?? 0) >= value ? 'on' : ''} onClick={() => rate(agent.id, value)}><Star size={16} /></button>)}</span></div>)}
    </div>}
    {error && <div className="app-error" role="alert">{error}</div>}
  </>;
}

export default CaseAgentPanel;
