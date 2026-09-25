import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Bell, Check, FileText, KeyRound, Plus, ShieldCheck, UserRound, UsersRound, Wallet } from 'lucide-react';
import type { Session } from './api';
import type { FinanceMember } from './types';
import BillingPage from './BillingPage';
import ApiKeysCard from './ApiKeysCard';

export type SettingsTab = 'profile' | 'team' | 'billing' | 'api' | 'security';

type Props = {
  session: Session;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  members: FinanceMember[];
  membersLoading: boolean;
  onAddMember: () => void;
  onChangeMemberStatus: (member: FinanceMember) => void;
  onSaveProfile: (values: { name: string; city: string }) => Promise<void>;
};

// One section at a time instead of one long page: a short section list on the left, the chosen panel on the right.
function SettingsPage({ session, tab, onTabChange, members, membersLoading, onAddMember, onChangeMemberStatus, onSaveProfile }: Props) {
  const can = (permission: string) => session.user.permissions.includes(permission);
  const sections: Array<{ id: SettingsTab; label: string; icon: ReactNode; visible: boolean }> = [
    { id: 'profile', label: 'Profile', icon: <UserRound size={16} />, visible: true },
    { id: 'team', label: 'Team', icon: <UsersRound size={16} />, visible: can('member.manage') },
    { id: 'billing', label: 'Billing & wallet', icon: <Wallet size={16} />, visible: can('billing.manage') },
    { id: 'api', label: 'API keys', icon: <KeyRound size={16} />, visible: can('organization.manage') },
    { id: 'security', label: 'Security', icon: <ShieldCheck size={16} />, visible: true },
  ];
  const visible = sections.filter((section) => section.visible);
  const active = visible.some((section) => section.id === tab) ? tab : 'profile';

  return <>
    <div className="page-heading"><div><p className="eyebrow">{session.user.tenantName}</p><h2>Settings</h2></div></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{visible.map((section) => <button key={section.id} type="button" aria-current={active === section.id ? 'page' : undefined} className={active === section.id ? 'active' : ''} onClick={() => onTabChange(section.id)}>{section.icon}<span>{section.label}</span></button>)}</nav>
      <div className="settings-panel">
        {active === 'profile' && <ProfilePanel session={session} onSave={onSaveProfile} />}
        {active === 'team' && <TeamPanel session={session} members={members} loading={membersLoading} onAdd={onAddMember} onChangeStatus={onChangeMemberStatus} />}
        {active === 'billing' && <BillingPage session={session} />}
        {active === 'api' && <ApiKeysCard session={session} />}
        {active === 'security' && <SecurityPanel />}
      </div>
    </div>
  </>;
}

function ProfilePanel({ session, onSave }: { session: Session; onSave: (values: { name: string; city: string }) => Promise<void> }) {
  const [name, setName] = useState(session.user.name);
  const [city, setCity] = useState(session.user.city ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== session.user.name || city.trim() !== (session.user.city ?? '');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try { await onSave({ name: name.trim(), city: city.trim() }); } finally { setSaving(false); }
  }
  return <article className="card settings-block">
    <div className="card-heading"><div><h3>Your profile</h3><p>Mobile number and role are fixed to your sign-in identity</p></div></div>
    <form className="profile-form" onSubmit={submit}>
      <div className="form-two-col">
        <label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} /></label>
        <label className="field-label">City<input value={city} onChange={(event) => setCity(event.target.value)} required minLength={2} maxLength={100} /></label>
        <label className="field-label">Mobile<input value={session.user.mobile ?? ''} readOnly disabled /></label>
        <label className="field-label">Role<input value={session.user.role.replace(/_/g, ' ')} readOnly disabled className="capitalize" /></label>
      </div>
      <dl className="detail-grid"><div><dt>Company</dt><dd>{session.user.tenantName ?? '—'}</dd></div><div><dt>Permissions</dt><dd>{session.user.permissions.length} granted</dd></div></dl>
      <div className="modal-actions"><button className="primary-button" type="submit" disabled={!dirty || saving}><Check size={15} /> {saving ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  </article>;
}

function TeamPanel({ session, members, loading, onAdd, onChangeStatus }: { session: Session; members: FinanceMember[]; loading: boolean; onAdd: () => void; onChangeStatus: (member: FinanceMember) => void }) {
  const canChange = (member: FinanceMember) => member.id !== session.user.id && member.role !== 'super_admin' && (session.user.role === 'super_admin' || member.role === 'finance_staff');
  return <article className="card data-card">
    <div className="card-heading"><div><h3>Finance users</h3><p>Everyone in your company who signs in with a mobile OTP</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add finance user</button></div>
    <div className="table-scroll"><table><thead><tr><th>User</th><th>Mobile</th><th>City</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan={6}><div className="empty-table">Loading finance users…</div></td></tr> : members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong></td><td className="mono">{member.mobile}</td><td>{member.city}</td><td className="capitalize">{member.role.replace(/_/g, ' ')}</td><td><span className={`agent-status ${member.active ? 'good' : 'off'}`}>{member.active ? 'Active' : 'Suspended'}</span></td><td>{canChange(member) && <button className="text-button" onClick={() => onChangeStatus(member)}>{member.active ? 'Suspend' : 'Reactivate'}</button>}</td></tr>)}</tbody></table></div>
  </article>;
}

function SecurityPanel() {
  return <section className="settings-grid">
    <article className="card settings-card"><ShieldCheck size={20} /><h3>OTP sign-in and sessions</h3><p>Mobile OTP sign-in, hashed session tokens, expiry, sign-out revocation and suspension revocation are active.</p></article>
    <article className="card settings-card"><Bell size={20} /><h3>Audit trail and notifications</h3><p>Every finance and field action is recorded in an audit trail that cannot be edited, and notifications are kept per company.</p></article>
    <article className="card settings-card"><FileText size={20} /><h3>Loan-data sources</h3><p>CSV and XLSX imports, manual accounts and the API all keep immutable monthly snapshots with duplicate-file detection.</p></article>
  </section>;
}

export default SettingsPage;
