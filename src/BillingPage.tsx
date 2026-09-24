import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Lock, Wallet } from 'lucide-react';
import { api } from './api';
import type { BillingSummary, Session } from './api';

export function rupees(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

export function errorMessage(cause: unknown, fallback = 'Something went wrong. Try again.') {
  return cause instanceof Error ? cause.message : fallback;
}

const itemLabels: Record<string, string> = { case_import: 'Imported row', case_manual: 'Manual account', case_api: 'API record', verification: 'House verification' };

function BillingPage({ session }: { session: Session }) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.billing(session.token).then(setSummary).catch((cause) => setError(errorMessage(cause, 'Billing could not be loaded.')));
  }, [session.token]);

  async function submitRecharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amount) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.requestTopup(session.token, amount, reference.trim());
      setNotice(`Recharge request for ${rupees(amount)} sent. Your wallet is credited as soon as the payment is confirmed.`);
      setAmount(null); setReference('');
      setSummary(await api.billing(session.token));
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  if (!summary) return error ? <div className="app-error" role="alert">{error}</div> : <div className="workspace-loading" role="status">Loading billing…</div>;

  return <>
    <div className="page-heading"><div><p className="eyebrow">Prepaid wallet</p><h2>Billing and wallet</h2><p className="page-copy">{rupees(summary.prices.vehicleRowPaise)} per vehicle row imported, added or received by API · {rupees(summary.prices.verificationFeePaise)} per house verification request.</p></div></div>
    {error && <div className="app-error" role="alert">{error}</div>}
    {notice && <div className="app-notice" role="status">{notice}</div>}
    <section className="count-strip">
      <div><strong>{rupees(summary.balancePaise)}</strong><span>Wallet balance</span></div>
      <div><strong>{rupees(summary.duePaise)}</strong><span>{summary.lockedCount} record{summary.lockedCount === 1 ? '' : 's'} waiting for recharge</span></div>
      <div><strong>{summary.month.count}</strong><span>Billed this month · {rupees(summary.month.amountPaise)}</span></div>
      <div><strong>{summary.allTime.count}</strong><span>Billed all time · {rupees(summary.allTime.amountPaise)}</span></div>
    </section>
    {summary.lockedCount > 0 && <div className="locked-banner"><Lock size={16} /><span>{summary.lockedCount} record{summary.lockedCount === 1 ? ' is' : 's are'} locked. Recharge at least {rupees(summary.duePaise)} to unlock {summary.lockedCount === 1 ? 'it' : 'them'} automatically, oldest first.</span></div>}

    <article className="card settings-block">
      <h3><Wallet size={17} /> Recharge wallet</h3>
      <form onSubmit={submitRecharge} className="recharge-form">
        <div className="recharge-options" role="radiogroup" aria-label="Recharge amount">{summary.topupAmountsPaise.map((option) => <button type="button" role="radio" aria-checked={amount === option} key={option} className={amount === option ? 'recharge-option selected' : 'recharge-option'} onClick={() => setAmount(option)}><strong>{rupees(option)}</strong><small>{Math.floor(option / summary.prices.vehicleRowPaise)} vehicle rows</small></button>)}</div>
        {amount && <>
          <div className="payment-instructions"><p className="section-label">Pay {rupees(amount)} to</p><p>{summary.paymentInstructions || 'Payment details will be shared by Handoff support.'}</p></div>
          <label className="field-label">UPI / bank payment reference<input value={reference} onChange={(event) => setReference(event.target.value)} required minLength={4} maxLength={100} placeholder="e.g. UTR 4172 9910 3321" /></label>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAmount(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Send recharge request</button></div>
        </>}
      </form>
    </article>

    <article className="card data-card"><div className="card-heading"><div><h3>Recharge requests</h3><p>Credited after the payment is confirmed</p></div></div><div className="table-scroll"><table><thead><tr><th>Requested</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>{summary.topups.length ? summary.topups.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('en-IN')}</td><td>{rupees(item.amountPaise)}</td><td className="mono">{item.reference}</td><td><span className={`status-pill ${item.status === 'confirmed' ? 'green' : item.status === 'rejected' ? 'red' : 'amber'}`}><i />{item.status}</span></td></tr>) : <tr><td colSpan={4}><div className="empty-table">No recharge requests yet.</div></td></tr>}</tbody></table></div></article>

    <article className="card data-card"><div className="card-heading"><div><h3>Imports billed</h3><p>Every accepted row in every import is one billed application</p></div></div><div className="table-scroll"><table><thead><tr><th>File</th><th>Loan month</th><th>Rows billed</th><th>Amount</th><th>Waiting for recharge</th></tr></thead><tbody>{summary.imports.length ? summary.imports.map((item) => <tr key={item.id}><td><strong>{item.fileName}</strong><small>{new Date(item.createdAt).toLocaleString('en-IN')}</small></td><td>{item.snapshotMonth.slice(0, 7)}</td><td>{item.rowsCharged}</td><td>{rupees(item.amountPaise)}</td><td>{item.pendingRows}</td></tr>) : <tr><td colSpan={5}><div className="empty-table">No imports yet.</div></td></tr>}</tbody></table></div></article>

    <article className="card data-card"><div className="card-heading"><div><h3>Charges</h3><p>Latest 100 billed items</p></div></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Item</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{summary.charges.length ? summary.charges.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('en-IN')}</td><td>{itemLabels[item.itemType] ?? item.itemType}</td><td className="mono">{item.itemId}</td><td>{rupees(item.amountPaise)}</td><td>{item.status === 'paid' ? 'Paid' : 'Waiting for recharge'}</td></tr>) : <tr><td colSpan={5}><div className="empty-table">Nothing billed yet.</div></td></tr>}</tbody></table></div></article>
  </>;
}

export default BillingPage;
