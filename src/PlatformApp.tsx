import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, LogOut, X } from 'lucide-react';
import { api } from './api';
import type { PlatformOverview, Session } from './api';
import { errorMessage, rupees } from './BillingPage';

// The operator console: confirm wallet recharges, watch every company's balance, set platform prices.
function PlatformApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    try { setOverview(await api.platformOverview(session.token)); } catch (cause) { setError(errorMessage(cause, 'The platform overview could not be loaded.')); }
  }

  useEffect(() => { void reload(); }, [session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(topupId: string, decision: 'confirm' | 'reject', label: string) {
    if (!window.confirm(decision === 'confirm' ? `Confirm you received ${label}? The wallet is credited immediately.` : `Reject the ${label} recharge request?`)) return;
    setBusyId(topupId); setError(''); setNotice('');
    try {
      const result = await api.decideTopup(session.token, topupId, decision);
      setNotice(decision === 'confirm' ? `Recharge confirmed. ${result.settled} locked record(s) were unlocked.` : 'Recharge request rejected.');
      await reload();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(''); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(''); setNotice('');
    try {
      await api.updatePlatformSettings(session.token, {
        vehicleRowRupees: Number(form.get('vehicleRowRupees')),
        verificationFeeRupees: Number(form.get('verificationFeeRupees')),
        paymentInstructions: String(form.get('paymentInstructions') || ''),
      });
      setNotice('Prices and payment instructions saved. New charges use these prices.');
      await reload();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const pending = overview?.topups.filter((item) => item.status === 'pending') ?? [];
  const decided = overview?.topups.filter((item) => item.status !== 'pending') ?? [];

  return <div className="platform-shell">
    <header className="platform-header"><img className="brand-logo" src="/handoff-logo-white.png" alt="Handoff" /><span>Platform admin</span><button className="text-button" onClick={onLogout}><LogOut size={15} /> Sign out</button></header>
    <main className="platform-main">
      {error && <div className="app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
      {notice && <div className="app-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
      {!overview ? <div className="workspace-loading" role="status">Loading platform overview…</div> : <>
        <section className="count-strip">
          <div><strong>{pending.length}</strong><span>Recharges to confirm</span></div>
          <div><strong>{rupees(overview.tenants.reduce((sum, item) => sum + item.balancePaise, 0))}</strong><span>Held in wallets</span></div>
          <div><strong>{rupees(overview.tenants.reduce((sum, item) => sum + item.duePaise, 0))}</strong><span>Waiting for recharge</span></div>
          <div><strong>{overview.tenants.length}</strong><span>Finance companies</span></div>
        </section>

        <article className="card data-card"><div className="card-heading"><div><h3>Recharges to confirm</h3><p>Check the reference against your bank or UPI statement before confirming</p></div></div><div className="table-scroll"><table><thead><tr><th>Company</th><th>Amount</th><th>Reference</th><th>Requested</th><th /></tr></thead><tbody>{pending.length ? pending.map((item) => <tr key={item.id}><td><strong>{item.tenantName}</strong><small>{item.requestedBy}</small></td><td>{rupees(item.amountPaise)}</td><td className="mono">{item.reference}</td><td>{new Date(item.createdAt).toLocaleString('en-IN')}</td><td className="row-buttons"><button className="primary-button" disabled={busyId === item.id} onClick={() => decide(item.id, 'confirm', `${rupees(item.amountPaise)} from ${item.tenantName}`)}><Check size={14} /> Confirm</button><button className="secondary-button" disabled={busyId === item.id} onClick={() => decide(item.id, 'reject', `${rupees(item.amountPaise)} from ${item.tenantName}`)}>Reject</button></td></tr>) : <tr><td colSpan={5}><div className="empty-table">No recharge requests are waiting.</div></td></tr>}</tbody></table></div></article>

        <article className="card data-card"><div className="card-heading"><div><h3>Finance companies</h3><p>Wallet balance and unpaid charges</p></div></div><div className="table-scroll"><table><thead><tr><th>Company</th><th>Balance</th><th>Waiting for recharge</th><th>Locked records</th><th>Billed items</th></tr></thead><tbody>{overview.tenants.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{rupees(item.balancePaise)}</td><td>{rupees(item.duePaise)}</td><td>{item.lockedCount}</td><td>{item.chargedCount}</td></tr>)}</tbody></table></div></article>

        <article className="card settings-block"><h3>Prices and payment instructions</h3>
          <form className="profile-form" onSubmit={saveSettings}>
            <label className="field-label">Price per vehicle row (₹)<input name="vehicleRowRupees" type="number" min={0} step={1} required defaultValue={overview.settings.vehicleRowPaise / 100} /></label>
            <label className="field-label">Platform fee per house verification (₹)<input name="verificationFeeRupees" type="number" min={0} step={1} required defaultValue={overview.settings.verificationFeePaise / 100} /></label>
            <label className="field-label">Payment instructions shown to financers<textarea name="paymentInstructions" rows={4} maxLength={2000} defaultValue={overview.settings.paymentInstructions} placeholder="UPI ID, bank account name, account number, IFSC" /></label>
            <div className="modal-actions"><button className="primary-button" type="submit">Save</button></div>
          </form>
        </article>

        {decided.length > 0 && <article className="card data-card"><div className="card-heading"><div><h3>Decided recharges</h3><p>Latest confirmed and rejected requests</p></div></div><div className="table-scroll"><table><thead><tr><th>Company</th><th>Amount</th><th>Reference</th><th>Status</th><th>Decided</th></tr></thead><tbody>{decided.map((item) => <tr key={item.id}><td>{item.tenantName}</td><td>{rupees(item.amountPaise)}</td><td className="mono">{item.reference}</td><td>{item.status}</td><td>{item.decidedAt ? new Date(item.decidedAt).toLocaleString('en-IN') : ''}</td></tr>)}</tbody></table></div></article>}
      </>}
    </main>
  </div>;
}

export default PlatformApp;
