import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Bell,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react';
import { api } from './api';
import type { Session } from './api';
import type { Agent, AppNotification, CaseStatus, CustodyRecord, EvidenceRecord, RecoveryCase, ReleasePass } from './types';

type Page = 'dashboard' | 'register' | 'cases' | 'agents' | 'custody' | 'releases' | 'notifications' | 'settings';
type DialogType = 'authority' | 'assign' | 'custody-review' | 'payment' | 'release' | null;

const navigation: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'register', label: 'Monthly register', icon: ClipboardCheck },
  { id: 'cases', label: 'Recovery cases', icon: FileText },
  { id: 'agents', label: 'Seizure agents', icon: UsersRound },
  { id: 'custody', label: 'Custody records', icon: PackageCheck },
  { id: 'releases', label: 'Release passes', icon: FileCheck2 },
];

const statusStyles: Record<CaseStatus, string> = {
  Imported: 'slate',
  Assigned: 'blue',
  Accepted: 'blue',
  'Attempt in progress': 'amber',
  'Unable to recover': 'red',
  Recovered: 'green',
  'Custody certificate issued': 'green',
  'Custody review': 'amber',
  'Payment pending': 'amber',
  'Payment confirmed': 'green',
  'Release pass printed': 'violet',
  Closed: 'slate',
};

const checklist = [
  'Battery', 'Spare tyre', 'Fuel level', 'Matting', 'Keys and key number', 'Meter / odometer', 'Existing damages',
  'Self motor', 'Wiper / motor', 'Stereo / infotainment', 'Ignition coil', 'Speakers', 'Side mirrors', 'Tyre condition',
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function agentName(agentList: Agent[], agentId?: string) {
  return agentList.find((agent) => agent.id === agentId)?.name ?? 'Not assigned';
}

function StatusPill({ status }: { status: CaseStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}><i />{status}</span>;
}

function App({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('dashboard');
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [custody, setCustody] = useState<CustodyRecord[]>([]);
  const [releasePasses, setReleasePasses] = useState<ReleasePass[]>([]);
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [caseEvidence, setCaseEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [printPass, setPrintPass] = useState<ReleasePass | null>(null);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const unreadCount = appNotifications.filter((item) => !item.read).length;
  const activeCases = cases.filter((item) => !['Imported', 'Closed'].includes(item.status));
  const pendingReview = cases.filter((item) => ['Imported', 'Unable to recover', 'Custody review'].includes(item.status));
  const releaseReady = cases.filter((item) => item.status === 'Payment confirmed').length;

  const visibleCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cases;
    return cases.filter((item) => [item.id, item.accountNumber, item.borrower.name, item.borrower.mobile, item.vehicle.registration, item.vehicle.makeModel].some((value) => value.toLowerCase().includes(term)));
  }, [cases, search]);

  async function loadWorkspace() {
    const workspace = await api.workspace(session.token);
    setCases(workspace.cases);
    setCustody(workspace.custody);
    setReleasePasses(workspace.releasePasses);
    setAgentList(workspace.agents);
    setAppNotifications(workspace.notifications);
  }

  useEffect(() => {
    loadWorkspace().catch((error) => setActionError(error instanceof Error ? error.message : 'Unable to load this workspace.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCaseId) { setCaseEvidence([]); return; }
    setEvidenceLoading(true);
    api.evidence(session.token, selectedCaseId).then(({ evidence }) => setCaseEvidence(evidence)).catch(() => setCaseEvidence([])).finally(() => setEvidenceLoading(false));
  }, [selectedCaseId, session.token]);

  async function createImportedCase() {
    try {
      setActionError('');
      await api.importDemoCase(session.token);
      await loadWorkspace();
      setPage('register');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to import the register.'); }
  }

  async function assignCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase) return;
    const formData = new FormData(event.currentTarget);
    const selectedAgentId = String(formData.get('agentId'));
    const selectedAgent = agentList.find((item) => item.id === selectedAgentId);
    if (!selectedAgent) return;
    try {
      setActionError('');
      await api.assignCase(session.token, selectedCase.id, selectedAgent.id);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to assign this case.'); }
  }

  async function approveAuthority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase) return;
    const document = new FormData(event.currentTarget).get('document');
    if (!(document instanceof File) || !document.size) return;
    try {
      setActionError('');
      await api.approveAuthority(session.token, selectedCase.id, document);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to approve recovery authority.'); }
  }

  async function approveCustody(note: string) {
    if (!selectedCase) return;
    try {
      setActionError('');
      await api.approveCustody(session.token, selectedCase.id, note);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to approve the custody report.'); }
  }

  async function clearPayment(reference: string) {
    if (!selectedCase) return;
    try {
      setActionError('');
      await api.confirmPayment(session.token, selectedCase.id, reference);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to confirm payment.'); }
  }

  async function issueReleasePass() {
    if (!selectedCase) return;
    try {
      setActionError('');
      await api.releasePass(session.token, selectedCase.id);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to issue the release pass.'); }
  }

  async function closeCase() {
    if (!selectedCase) return;
    try {
      setActionError('');
      await api.closeCase(session.token, selectedCase.id);
      await loadWorkspace();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to close the case.'); }
  }

  function printReleasePass(pass: ReleasePass) {
    setPrintPass(pass);
    window.setTimeout(() => window.print(), 80);
  }

  const pageContent: Record<Page, ReactNode> = {
    dashboard: <Dashboard cases={cases} agentList={agentList} activeCases={activeCases} pendingReview={pendingReview} releaseReady={releaseReady} onSelectCase={setSelectedCaseId} onPageChange={setPage} />, 
    register: <RegisterPage cases={visibleCases} onImport={createImportedCase} onSelectCase={setSelectedCaseId} />, 
    cases: <CasesPage cases={visibleCases} onSelectCase={setSelectedCaseId} />, 
    agents: <AgentsPage agents={agentList} cases={cases} onSelectCase={setSelectedCaseId} />, 
    custody: <CustodyPage custody={custody} cases={cases} onSelectCase={setSelectedCaseId} />, 
    releases: <ReleasesPage cases={cases} onSelectCase={setSelectedCaseId} />, 
    notifications: <NotificationsPage items={appNotifications} onReadAll={async () => { await api.readNotifications(session.token); await loadWorkspace(); }} />, 
    settings: <SettingsPage />, 
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>handoff</span></div>
        <div className="workspace-label">{session.user.tenantName}</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-link active' : 'nav-link'} onClick={() => { setPage(id); setMobileNavOpen(false); }}><Icon size={17} /> <span>{label}</span>{id === 'register' && <b>{cases.length}</b>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="security-note"><ShieldCheck size={16} /><div><strong>Tenant protected</strong><span>Audit trail is active</span></div></div>
        <button className={page === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('settings')}><Settings size={17} /> <span>Settings</span></button>
        <button className="profile" onClick={onLogout} title="Sign out"><span className="avatar">{session.user.name.split(' ').map((word) => word[0]).join('')}</span><div><strong>{session.user.name}</strong><small>{session.user.role.replace('_', ' ')}</small></div><LogOut size={15} /></button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen((value) => !value)} aria-label="Toggle navigation"><Menu size={21} /></button>
          <div><p className="date-label">Thursday, August 6</p><h1>{page === 'dashboard' ? 'Good morning, Arun' : navigation.find((item) => item.id === page)?.label ?? page}</h1></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases, people, vehicles..." /><kbd>⌘ K</kbd></label>
            <button className="notification-button" onClick={() => setPage('notifications')} aria-label="Open notifications"><Bell size={18} />{unreadCount > 0 && <b>{unreadCount}</b>}</button>
            <button className="primary-button" onClick={createImportedCase}><Plus size={16} /> Import register</button>
          </div>
        </header>
        <section className="content-area">{actionError && <div className="app-error">{actionError}<button onClick={() => setActionError('')}><X size={14} /></button></div>}{loading ? <div className="workspace-loading">Loading your tenant workspace…</div> : pageContent[page]}</section>
      </main>

      {selectedCase && <CaseDrawer caseItem={selectedCase} agentList={agentList} custody={custody.find((record) => record.id === selectedCase.custodyId)} evidence={caseEvidence} evidenceLoading={evidenceLoading} releasePass={releasePasses.find((pass) => pass.caseId === selectedCase.id)} session={session} onClose={() => { setSelectedCaseId(null); setDialog(null); }} onOpenDialog={setDialog} onCloseCase={closeCase} onPrint={printReleasePass} />}
      {dialog === 'authority' && selectedCase && <AuthorityDialog caseItem={selectedCase} onClose={() => setDialog(null)} onSubmit={approveAuthority} />}
      {dialog === 'assign' && selectedCase && <AssignDialog caseItem={selectedCase} agentList={agentList} onClose={() => setDialog(null)} onSubmit={assignCase} />}
      {dialog === 'custody-review' && selectedCase && <CustodyReviewDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={approveCustody} />}
      {dialog === 'payment' && selectedCase && <PaymentDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={clearPayment} />}
      {dialog === 'release' && selectedCase && <ReleaseDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={issueReleasePass} />}
      {printPass && <PrintableReleasePass pass={printPass} caseItem={cases.find((item) => item.id === printPass.caseId)} custody={custody.find((item) => item.id === printPass.custodyId)} tenantName={session.user.tenantName} />}
    </div>
  );
}

function Dashboard({ cases, agentList, activeCases, pendingReview, releaseReady, onSelectCase, onPageChange }: { cases: RecoveryCase[]; agentList: Agent[]; activeCases: RecoveryCase[]; pendingReview: RecoveryCase[]; releaseReady: number; onSelectCase: (id: string) => void; onPageChange: (page: Page) => void }) {
  const pendingAmount = activeCases.reduce((sum, item) => sum + item.pendingAmount, 0);
  const inField = cases.filter((item) => ['Assigned', 'Accepted', 'Attempt in progress'].includes(item.status));
  return <>
    <div className="page-heading"><div><p className="eyebrow">Finance operations</p><h2>Recovery overview</h2></div><button className="date-control">August 2026 <ChevronDown size={14} /></button></div>
    <section className="metric-grid">
      <MetricCard icon={<ClipboardCheck size={19} />} label="Open recovery cases" value={activeCases.length.toString()} foot="Across 4 active branches" tone="blue" />
      <MetricCard icon={<Clock3 size={19} />} label="Need finance review" value={pendingReview.length.toString()} foot="Imports and failed attempts" tone="amber" />
      <MetricCard icon={<Gauge size={19} />} label="Pending value" value={formatCurrency(pendingAmount)} foot="Across active recovery cases" tone="violet" />
      <MetricCard icon={<FileCheck2 size={19} />} label="Ready for release" value={releaseReady.toString()} foot="Payment confirmed by finance" tone="green" />
    </section>
    <section className="workflow-strip"><div><p className="eyebrow">Controlled operating flow</p><h3>Every action moves through a recorded case lifecycle.</h3></div><ol><li className="done"><span>1</span>Import</li><li className="done"><span>2</span>Assign</li><li className="current"><span>3</span>Field report</li><li><span>4</span>Custody</li><li><span>5</span>Release</li></ol></section>
    <section className="dashboard-columns">
      <article className="card case-card"><CardHeading title="Active field work" description="Cases assigned to independent agents" action="View cases" onAction={() => onPageChange('cases')} />
        <div className="table-scroll"><table><thead><tr><th>Case</th><th>Vehicle</th><th>Assigned agent</th><th>Status</th><th /></tr></thead><tbody>{inField.map((item) => <tr key={item.id} className="row-action" onClick={() => onSelectCase(item.id)}><td><strong>{item.borrower.name}</strong><small>{item.id}</small></td><td>{item.vehicle.registration}<small>{item.vehicle.makeModel}</small></td><td>{agentName(agentList, item.assignedAgentId)}</td><td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      </article>
      <aside className="dashboard-side">
        <article className="card attention-card"><div className="attention-icon"><Bell size={18} /></div><p className="eyebrow">Action needed</p><h3>Review {pendingReview.length} case{pendingReview.length === 1 ? '' : 's'} before the next assignment.</h3><button onClick={() => onPageChange('register')}>Open monthly register <ChevronRight size={15} /></button></article>
        <article className="card activity-card"><CardHeading title="Recent activity" description="Latest finance and field updates" />{cases.slice(0, 4).map((item) => <div className="activity-row" key={item.id}><span className={`activity-dot ${statusStyles[item.status]}`}><Check size={11} /></span><div><p><strong>{item.id}</strong> · {item.status}</p><small>{item.updatedAt}</small></div></div>)}</article>
      </aside>
    </section>
  </>;
}

function MetricCard({ icon, label, value, foot, tone }: { icon: ReactNode; label: string; value: string; foot: string; tone: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{foot}</small></article>;
}

function CardHeading({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="card-heading"><div><h3>{title}</h3><p>{description}</p></div>{action && <button className="text-button" onClick={onAction}>{action} <ChevronRight size={14} /></button>}</div>;
}

function RegisterPage({ cases, onImport, onSelectCase }: { cases: RecoveryCase[]; onImport: () => void; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">August 2026 loan cycle</p><h2>Monthly delinquency register</h2><p className="page-copy">Imported borrower and vehicle accounts are reviewed before they become recovery cases.</p></div><div className="heading-actions"><button className="secondary-button"><SlidersHorizontal size={15} /> Filter</button><button className="primary-button" onClick={onImport}><Plus size={16} /> Import monthly file</button></div></div><section className="register-band"><div><strong>{cases.length}</strong><span>imported accounts</span></div><div><strong>{formatCurrency(cases.reduce((sum, item) => sum + item.pendingAmount, 0))}</strong><span>visible pending amount</span></div><div><strong>{cases.filter((item) => item.status === 'Imported').length}</strong><span>awaiting first review</span></div><p>Only authorized finance users can view this borrower data.</p></section><CaseTable cases={cases} onSelectCase={onSelectCase} showLoan /> <section className="compliance-banner"><ShieldCheck size={18} /><p><strong>Finance control point.</strong> Importing an overdue account does not create recovery authority. Your finance team decides which cases are assigned.</p></section></>;
}

function CasesPage({ cases, onSelectCase }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">Assigned and active work</p><h2>Recovery cases</h2><p className="page-copy">Open a case to assign an agent, review field evidence, or progress custody and release.</p></div><button className="secondary-button"><SlidersHorizontal size={15} /> All statuses</button></div><CaseTable cases={cases} onSelectCase={onSelectCase} showLoan /></>;
}

function CaseTable({ cases, onSelectCase, showLoan }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void; showLoan: boolean }) {
  return <article className="card data-card"><div className="table-scroll"><table className="case-table"><thead><tr><th>Borrower</th><th>Mobile</th><th>Vehicle</th><th>Registration</th>{showLoan && <th>Pending amount</th>}<th>Status</th><th /></tr></thead><tbody>{cases.map((item) => <tr key={item.id} className="row-action" onClick={() => onSelectCase(item.id)}><td><strong>{item.borrower.name}</strong><small>{item.id} · {item.branch}</small></td><td className="mono">{item.borrower.mobile}</td><td>{item.vehicle.makeModel}<small>{item.vehicle.type}</small></td><td className="mono">{item.vehicle.registration}</td>{showLoan && <td className="amount">{formatCurrency(item.pendingAmount)}<small>{item.overdueDays} days overdue</small></td>}<td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div></article>;
}

function AgentsPage({ agents, cases, onSelectCase }: { agents: Agent[]; cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">External field workforce</p><h2>Seizure agents</h2><p className="page-copy">Independent agents only receive the cases your finance users assign to them.</p></div><button className="primary-button"><Plus size={16} /> Add agent</button></div><section className="agent-grid">{agents.map((agent) => { const assigned = cases.filter((item) => item.assignedAgentId === agent.id && item.status !== 'Closed'); return <article className="card agent-card" key={agent.id}><div className="agent-card-top"><span className="agent-avatar">{agent.name.split(' ').map((word) => word[0]).join('')}</span><span className={`agent-status ${agent.status === 'Active' ? 'good' : 'off'}`}>{agent.status}</span></div><h3>{agent.name}</h3><p>{agent.city} · {agent.mobile}</p><div className="agent-stats"><span><strong>{assigned.length}</strong>active cases</span><span><strong>{agent.completedThisMonth}</strong>completed this month</span></div>{assigned.length > 0 && <button className="agent-case-link" onClick={() => onSelectCase(assigned[0].id)}>Open current case <ChevronRight size={14} /></button>}</article>; })}</section></>;
}

function CustodyPage({ custody, cases, onSelectCase }: { custody: CustodyRecord[]; cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">Digital parking check slips</p><h2>Custody records</h2><p className="page-copy">A condition and handover record is created when an agent reports custody.</p></div><button className="secondary-button"><FileText size={15} /> Receipt fields</button></div><article className="card data-card"><div className="table-scroll"><table><thead><tr><th>Certificate</th><th>Vehicle / case</th><th>Parking location</th><th>Agent</th><th>Checklist</th><th /></tr></thead><tbody>{custody.map((item) => { const caseItem = cases.find((current) => current.id === item.caseId); return <tr className="row-action" key={item.id} onClick={() => onSelectCase(item.caseId)}><td><strong className="token-id">{item.id}</strong><small>{item.createdAt}</small></td><td>{caseItem?.vehicle.registration}<small>{item.caseId} · {caseItem?.vehicle.makeModel}</small></td><td>{item.yardName}<small>{item.arrivalTime}</small></td><td>{item.agentName}</td><td><span className="checked-count"><Check size={12} /> {item.checklist}/{checklist.length}</span></td><td><ChevronRight size={17} /></td></tr>; })}</tbody></table></div></article><section className="receipt-grid">{checklist.map((item) => <span key={item}><Check size={14} /> {item}</span>)}</section></>;
}

function ReleasesPage({ cases, onSelectCase }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  const releaseCases = cases.filter((item) => ['Payment confirmed', 'Release pass printed', 'Closed'].includes(item.status));
  return <><div className="page-heading"><div><p className="eyebrow">Financer-controlled customer handover</p><h2>Release passes</h2><p className="page-copy">A printable pass is issued only after a finance employee manually confirms payment.</p></div><button className="secondary-button"><FileText size={15} /> Print history</button></div><article className="card data-card"><div className="table-scroll"><table><thead><tr><th>Customer</th><th>Vehicle</th><th>Payment status</th><th>Release pass</th><th>Current state</th><th /></tr></thead><tbody>{releaseCases.length ? releaseCases.map((item) => <tr className="row-action" onClick={() => onSelectCase(item.id)} key={item.id}><td><strong>{item.borrower.name}</strong><small>{item.borrower.mobile}</small></td><td>{item.vehicle.registration}<small>{item.vehicle.makeModel}</small></td><td><span className="checked-count"><Check size={12} /> Confirmed by finance</span></td><td className="token-id">{item.releasePassId ?? 'Not issued'}</td><td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>) : <tr><td colSpan={6}><div className="empty-table">No customer release passes are ready yet.</div></td></tr>}</tbody></table></div></article><section className="release-process"><span>1. Financer confirms dues</span><ChevronRight size={16} /><span>2. Print release pass</span><ChevronRight size={16} /><span>3. Customer presents pass at parking yard</span><ChevronRight size={16} /><span>4. Financer closes case</span></section></>;
}

function NotificationsPage({ items, onReadAll }: { items: AppNotification[]; onReadAll: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">Finance and field updates</p><h2>Notifications</h2><p className="page-copy">Assignments, field updates, custody records, payment confirmation, and release events.</p></div><button className="secondary-button" onClick={onReadAll}><Check size={15} /> Mark all read</button></div><article className="card notification-list">{items.map((item) => <div className={`notification-row ${item.read ? '' : 'unread'}`} key={item.id}><span className={`notification-icon ${item.tone}`}><Bell size={16} /></span><div><h3>{item.title}</h3><p>{item.detail}</p><small>{item.createdAt}</small></div>{!item.read && <i />}</div>)}</article></>;
}

function SettingsPage() {
  return <><div className="page-heading"><div><p className="eyebrow">Finance company workspace</p><h2>Settings</h2><p className="page-copy">Tenant controls, notification preferences, agent access, and future integrations.</p></div></div><section className="settings-grid"><article className="card settings-card"><ShieldCheck size={20} /><h3>Users and permissions</h3><p>Set finance-user and external-agent access within this financer workspace.</p><button className="text-button">Manage access <ChevronRight size={14} /></button></article><article className="card settings-card"><Bell size={20} /><h3>In-app notifications</h3><p>Configure alerts for assignments, failed attempts, custody reports, and release events.</p><button className="text-button">Configure alerts <ChevronRight size={14} /></button></article><article className="card settings-card"><FileText size={20} /><h3>Loan-data sources</h3><p>Excel imports are active. Loan-system API connection is the next integration slice.</p><button className="text-button">View import settings <ChevronRight size={14} /></button></article></section></>;
}

function LegacyCaseDrawer({ caseItem, agentList, custody, onClose, onOpenDialog, onCloseCase }: { caseItem: RecoveryCase; agentList: Agent[]; custody?: CustodyRecord; onClose: () => void; onOpenDialog: (dialog: DialogType) => void; onCloseCase: () => void }) {
  const actionButton = () => {
    if (caseItem.status === 'Imported' && !caseItem.authority) return <button className="primary-button full" onClick={() => onOpenDialog('authority')}><ShieldCheck size={16} /> Review recovery authority</button>;
    if (caseItem.status === 'Imported' || caseItem.status === 'Unable to recover') return <button className="primary-button full" onClick={() => onOpenDialog('assign')}><UsersRound size={16} /> {caseItem.status === 'Imported' ? 'Assign seizure agent' : 'Reassign case'}</button>;
    if (['Assigned', 'Accepted', 'Attempt in progress'].includes(caseItem.status)) return <div className="field-waiting"><Clock3 size={16} /> Awaiting the assigned agent’s field update.</div>;
    if (caseItem.status === 'Custody review') return <button className="primary-button full" onClick={() => onOpenDialog('custody-review')}><PackageCheck size={16} /> Review custody report</button>;
    if (caseItem.status === 'Payment pending') return <button className="primary-button full" onClick={() => onOpenDialog('payment')}><Check size={16} /> Confirm payment</button>;
    if (caseItem.status === 'Payment confirmed') return <button className="primary-button full" onClick={() => onOpenDialog('release')}><FileCheck2 size={16} /> Create printable release pass</button>;
    if (caseItem.status === 'Release pass printed') return <button className="primary-button full" onClick={onCloseCase}><Check size={16} /> Mark vehicle released and close</button>;
    return <div className="closed-note"><Check size={15} /> Case closed</div>;
  };
  const assignedName = agentName(agentList, caseItem.assignedAgentId);
  return <><div className="drawer-backdrop" onClick={onClose} /><aside className="case-drawer"><div className="drawer-top"><div><p className="eyebrow">{caseItem.id}</p><h2>{caseItem.borrower.name}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div><StatusPill status={caseItem.status} /><div className="drawer-section"><p className="section-label">Borrower</p><div className="detail-list"><span><UsersRound size={14} /> {caseItem.borrower.mobile}</span><span><MapPin size={14} /> {caseItem.borrower.address}</span></div></div><div className="drawer-section"><p className="section-label">Vehicle and loan</p><div className="vehicle-card"><span>{caseItem.vehicle.type === '2-wheeler' ? '2W' : '4W'}</span><div><strong>{caseItem.vehicle.registration}</strong><p>{caseItem.vehicle.makeModel}</p></div></div><dl className="detail-grid"><div><dt>Pending amount</dt><dd>{formatCurrency(caseItem.pendingAmount)}</dd></div><div><dt>Overdue</dt><dd>{caseItem.overdueDays} days</dd></div><div><dt>Loan account</dt><dd>{caseItem.accountNumber}</dd></div><div><dt>Chassis</dt><dd>{caseItem.vehicle.chassis}</dd></div></dl></div><div className="drawer-section"><p className="section-label">Assignment</p><div className="assignment-detail"><span className="agent-avatar small">{assignedName.split(' ').map((word) => word[0]).join('')}</span><div><strong>{assignedName}</strong><small>{caseItem.assignedAt ? new Date(caseItem.assignedAt).toLocaleString() : 'Waiting for finance assignment'}</small></div></div></div>{caseItem.failure && <div className="failure-note"><span>!</span><div><strong>{caseItem.failure.reason}</strong><p>{caseItem.failure.note}</p><small>{caseItem.failure.recordedAt}</small></div></div>}{custody && <div className="custody-summary"><PackageCheck size={17} /><div><strong>{custody.id}</strong><p>{custody.yardName}</p><small>{custody.checklist}/{checklist.length} check items recorded</small></div></div>}<div className="drawer-footer">{actionButton()}</div></aside></>;
}

function CaseDrawer({ caseItem, agentList, custody, evidence, evidenceLoading, releasePass, session, onClose, onOpenDialog, onCloseCase, onPrint }: { caseItem: RecoveryCase; agentList: Agent[]; custody?: CustodyRecord; evidence: EvidenceRecord[]; evidenceLoading: boolean; releasePass?: ReleasePass; session: Session; onClose: () => void; onOpenDialog: (dialog: DialogType) => void; onCloseCase: () => void; onPrint: (pass: ReleasePass) => void }) {
  const assignedName = agentName(agentList, caseItem.assignedAgentId);
  const actionButton = () => {
    if (caseItem.status === 'Imported' || caseItem.status === 'Unable to recover') return <button className="primary-button full" onClick={() => onOpenDialog('assign')}><UsersRound size={16} /> {caseItem.status === 'Imported' ? 'Assign seizure agent' : 'Reassign case'}</button>;
    if (['Assigned', 'Accepted', 'Attempt in progress'].includes(caseItem.status)) return <div className="field-waiting"><Clock3 size={16} /> Awaiting the assigned agent’s field update.</div>;
    if (['Recovered', 'Custody certificate issued', 'Payment pending'].includes(caseItem.status)) return <button className="primary-button full" onClick={() => onOpenDialog('payment')}><Check size={16} /> Confirm payment</button>;
    if (caseItem.status === 'Payment confirmed') return <button className="primary-button full" onClick={() => onOpenDialog('release')}><FileCheck2 size={16} /> Create printable release pass</button>;
    if (caseItem.status === 'Release pass printed') return <div className="drawer-actions vertical"><button className="secondary-button" disabled={!releasePass} onClick={() => releasePass && onPrint(releasePass)}><Printer size={15} /> Print customer pass</button><button className="primary-button" onClick={onCloseCase}><Check size={16} /> Mark vehicle released and close</button></div>;
    return <div className="closed-note"><Check size={15} /> Case closed</div>;
  };
  return <><div className="drawer-backdrop" onClick={onClose} /><aside className="case-drawer"><div className="drawer-top"><div><p className="eyebrow">{caseItem.id}</p><h2>{caseItem.borrower.name}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div><StatusPill status={caseItem.status} />
    <div className="drawer-section"><p className="section-label">Borrower</p><div className="detail-list"><span><UsersRound size={14} /> {caseItem.borrower.mobile}</span><span><MapPin size={14} /> {caseItem.borrower.address}</span></div></div>
    <div className="drawer-section"><p className="section-label">Vehicle and loan</p><div className="vehicle-card"><span>{caseItem.vehicle.type === '2-wheeler' ? '2W' : '4W'}</span><div><strong>{caseItem.vehicle.registration}</strong><p>{caseItem.vehicle.makeModel}</p></div></div><dl className="detail-grid"><div><dt>Pending amount</dt><dd>{formatCurrency(caseItem.pendingAmount)}</dd></div><div><dt>Overdue</dt><dd>{caseItem.overdueDays} days</dd></div><div><dt>Loan account</dt><dd>{caseItem.accountNumber}</dd></div><div><dt>Chassis</dt><dd>{caseItem.vehicle.chassis}</dd></div></dl></div>
    <div className="drawer-section"><p className="section-label">Recovery authority</p>{caseItem.authority ? <div className="payment-detail"><ShieldCheck size={16} /><div><strong>Approved by finance</strong><span>{caseItem.authority.documentName}</span><small>{new Date(caseItem.authority.approvedAt).toLocaleString()}</small></div></div> : <div className="evidence-empty">No authority document approved yet.</div>}</div>
    <div className="drawer-section"><p className="section-label">Assignment</p><div className="assignment-detail"><span className="agent-avatar small">{assignedName.split(' ').map((word) => word[0]).join('')}</span><div><strong>{assignedName}</strong><small>{caseItem.assignedAt ? new Date(caseItem.assignedAt).toLocaleString() : 'Waiting for finance assignment'}</small></div></div></div>
    {caseItem.failure && <div className="failure-note"><span>!</span><div><strong>{caseItem.failure.reason}</strong><p>{caseItem.failure.note}</p><small>{caseItem.failure.recordedAt}</small></div></div>}
    {(evidenceLoading || evidence.length > 0) && <EvidencePanel evidence={evidence} loading={evidenceLoading} token={session.token} />}
    {custody && <div className="drawer-section"><p className="section-label">Digital parking check slip</p><div className="custody-summary"><PackageCheck size={17} /><div><strong>{custody.id}</strong><p>{custody.yardName}</p><small>{custody.agentName} · ₹{custody.parkingRate}/day · {new Date(custody.arrivalTime).toLocaleString()}</small></div></div>{custody.inspection && <div className="inspection-summary">{Object.entries(custody.inspection).map(([item, condition]) => <span key={item}><strong>{item}</strong><small>{condition}</small></span>)}</div>}{custody.financeReviewedAt && <div className="payment-detail"><Check size={16} /><div><strong>Approved by finance</strong><span>{custody.financeReviewNote || 'Custody report accepted'}</span><small>{new Date(custody.financeReviewedAt).toLocaleString()}</small></div></div>}</div>}
    {caseItem.paymentReference && <div className="drawer-section"><p className="section-label">Finance payment confirmation</p><div className="payment-detail"><Check size={16} /><div><strong>Dues marked cleared</strong><span>{caseItem.paymentReference}</span><small>{caseItem.paymentConfirmedAt ? new Date(caseItem.paymentConfirmedAt).toLocaleString() : ''}</small></div></div></div>}
    {releasePass && <div className="drawer-section"><p className="section-label">Customer release token</p><div className="pass-summary"><FileCheck2 size={17} /><div><strong>{releasePass.id}</strong><span>Verification code: {releasePass.verificationCode}</span><small>Issued {new Date(releasePass.issuedAt).toLocaleString()}</small></div></div></div>}
    <div className="drawer-footer">{actionButton()}</div>
  </aside></>;
}

function EvidencePanel({ evidence, loading, token }: { evidence: EvidenceRecord[]; loading: boolean; token: string }) {
  const [selected, setSelected] = useState<EvidenceRecord | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  async function openEvidence(record: EvidenceRecord) {
    setSelected(record); setError('');
    if (fileUrl) { URL.revokeObjectURL(fileUrl); setFileUrl(null); }
    try { setFileUrl(URL.createObjectURL(await api.evidenceFile(token, record.id))); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Evidence could not be loaded.'); }
  }

  return <div className="drawer-section"><p className="section-label">Agent evidence</p>{loading ? <div className="evidence-empty">Loading secured evidence…</div> : <><div className="evidence-meta"><Camera size={16} /><span>{evidence.length} file{evidence.length === 1 ? '' : 's'} captured in the field</span></div>{evidence.map((item) => <button className="evidence-row" key={item.id} onClick={() => openEvidence(item)}><Camera size={15} /><span><strong>{item.originalName}</strong><small>{item.agentName ?? 'Assigned agent'} · {new Date(item.capturedAt).toLocaleString()}{item.latitude !== null && item.longitude !== null ? ` · GPS ${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : ''}</small></span><ChevronRight size={15} /></button>)}</>}{selected && <div className="evidence-viewer"><div><strong>{selected.originalName}</strong><button onClick={() => { if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(null); setSelected(null); }}><X size={15} /></button></div>{error ? <p>{error}</p> : fileUrl ? selected.mimeType.startsWith('video/') ? <video src={fileUrl} controls /> : <img src={fileUrl} alt={`Evidence for ${selected.caseId}`} /> : <p>Loading evidence…</p>}</div>}</div>;
}

function PrintableReleasePass({ pass, caseItem, custody, tenantName }: { pass: ReleasePass; caseItem?: RecoveryCase; custody?: CustodyRecord; tenantName: string }) {
  return <section className="print-release-pass"><header><div><p>VEHICLE RELEASE AUTHORISATION</p><h1>{tenantName}</h1></div><strong>{pass.id}</strong></header><div className="print-release-state"><Check size={19} /> All recorded dues have been cleared by the finance company.</div><section className="print-release-grid"><div><span>Customer</span><strong>{pass.borrowerName}</strong><small>{pass.borrowerMobile}</small></div><div><span>Vehicle</span><strong>{pass.vehicleRegistration}</strong><small>{pass.vehicleModel}</small></div><div><span>Work order</span><strong>{pass.caseId}</strong><small>Payment ref: {pass.paymentReference ?? 'Recorded by finance'}</small></div><div><span>Custody location</span><strong>{custody?.yardName ?? 'As recorded by parking yard'}</strong><small>Certificate: {pass.custodyId ?? 'Not available'}</small></div></section><section className="print-verification"><div><span>ONE-TIME RELEASE TOKEN</span><strong>{pass.verificationCode}</strong><small>Issue date: {new Date(pass.issuedAt).toLocaleString()}</small></div><div className="print-code" aria-label="Manual verification code">{pass.verificationCode.slice(0, 5)}<br />{pass.verificationCode.slice(5)}</div></section><p className="print-note">Present this pass and an approved identity document at the recorded parking location. The finance company must verify the release token before the vehicle is handed over.</p><footer><span>Customer signature: ____________________</span><span>Authorised finance signatory: ____________________</span></footer>{caseItem && <small className="print-footer">Vehicle registration: {caseItem.vehicle.registration} · This document is a finance-issued release record.</small>}</section>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><p className="eyebrow">Finance-controlled workflow</p><h2>{title}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>{children}</section></div>;
}

function AssignDialog({ caseItem, agentList, onClose, onSubmit }: { caseItem: RecoveryCase; agentList: Agent[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Assign seizure agent" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">The selected independent agent will receive the full assigned-case information and an in-app notification.</p><div className="case-reference"><strong>{caseItem.id}</strong><span>{caseItem.vehicle.registration} · {caseItem.borrower.name}</span></div><label className="field-label">Select agent<select name="agentId" required defaultValue=""><option value="" disabled>Choose an active agent</option>{agentList.filter((agent) => agent.status === 'Active').map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.city} · {agent.activeCases} active cases</option>)}</select></label><label className="field-label">Assignment note<textarea name="assignmentNote" placeholder="Optional instruction for the assigned agent" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Send work order</button></div></form></Modal>;
}

function AuthorityDialog({ caseItem, onClose, onSubmit }: { caseItem: RecoveryCase; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Approve recovery authority" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">Verify the financer’s signed recovery authority before this case can be sent to an external seizure agent.</p><div className="case-reference"><strong>{caseItem.id}</strong><span>{caseItem.vehicle.registration} · {caseItem.borrower.name}</span></div><label className="field-label">Signed authority document<input name="document" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><label className="check-line"><input required type="checkbox" /> I verified that this document authorises recovery of the vehicle shown above.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><ShieldCheck size={15} /> Approve authority</button></div></form></Modal>;
}

function CustodyReviewDialog({ caseItem, onClose, onConfirm }: { caseItem: RecoveryCase; onClose: () => void; onConfirm: (note: string) => void }) {
  return <Modal title="Review custody report" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(String(new FormData(event.currentTarget).get('note') || '')); }}><p className="modal-copy">Check the agent evidence, GPS, vehicle-condition slip, and parking details before allowing payment clearance.</p><div className="case-reference"><strong>{caseItem.id}</strong><span>{caseItem.vehicle.registration} · {caseItem.borrower.name}</span></div><label className="field-label">Finance review note<textarea name="note" placeholder="Optional factual review note" /></label><label className="check-line"><input required type="checkbox" /> I reviewed the submitted custody record and evidence.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><PackageCheck size={15} /> Approve custody</button></div></form></Modal>;
}

function PaymentDialog({ caseItem, onClose, onConfirm }: { caseItem: RecoveryCase; onClose: () => void; onConfirm: (reference: string) => void }) {
  return <Modal title="Confirm payment clearance" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(String(new FormData(event.currentTarget).get('paymentReference'))); }}><p className="modal-copy">Only a finance employee can make this decision. Confirmation makes a printable customer release pass available.</p><div className="payment-card"><span><Check size={18} /></span><div><small>Pending amount</small><strong>{formatCurrency(caseItem.pendingAmount)}</strong><p>{caseItem.borrower.name} · {caseItem.vehicle.registration}</p></div></div><label className="field-label">Finance payment reference<input name="paymentReference" placeholder="Enter receipt, reference, or settlement note" required /></label><label className="check-line"><input id="payment-confirmation" required type="checkbox" /> I have manually confirmed that all required dues and charges are cleared.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Confirm payment</button></div></form></Modal>;
}

function ReleaseDialog({ caseItem, onClose, onConfirm }: { caseItem: RecoveryCase; onClose: () => void; onConfirm: () => void }) {
  const passId = `RP-26${caseItem.id.slice(-4)}`;
  return <Modal title="Create printable release pass" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}><p className="modal-copy">Give this receipt to the customer after payment is confirmed. The parking yard can verify the printed details manually in version 1.</p><div className="release-pass-preview"><div><p>VEHICLE RELEASE PASS</p><strong>{passId}</strong><span>{caseItem.vehicle.registration}</span></div><div className="qr-placeholder">QR</div><small>Issued for {caseItem.borrower.name}<br />One-time manual handover receipt</small></div><label className="check-line"><input id="release-confirmation" required type="checkbox" /> I confirm payment clearance and customer details have been verified.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><FileCheck2 size={15} /> Generate pass</button></div></form></Modal>;
}

export default App;
