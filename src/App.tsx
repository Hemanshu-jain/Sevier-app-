import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  Bell,
  Camera,
  Check,
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
  UsersRound,
  X,
} from 'lucide-react';
import { api } from './api';
import type { AccountInput, Session } from './api';
import type { Agent, AppNotification, AuditEvent, CaseStatus, CustodyRecord, EvidenceRecord, FinanceMember, RecoveryCase, ReleasePass } from './types';
import { caseStatusLabel } from './types';
import { financeCaseAction } from './finance-case-action';
import { isActivationKey, isSearchShortcut } from './interaction';
import { financeReviewCases, recoveryPipeline } from './desktop-metrics';

type Page = 'dashboard' | 'register' | 'cases' | 'agents' | 'custody' | 'releases' | 'reports' | 'notifications' | 'settings';
type DialogType = 'import' | 'account' | 'edit-account' | 'agent' | 'member' | 'authority' | 'assign' | 'custody-review' | 'payment' | 'release' | 'close' | null;

const navigation: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'register', label: 'Monthly register', icon: ClipboardCheck },
  { id: 'cases', label: 'Recovery cases', icon: FileText },
  { id: 'agents', label: 'Seizure agents', icon: UsersRound },
  { id: 'custody', label: 'Custody records', icon: PackageCheck },
  { id: 'releases', label: 'Release passes', icon: FileCheck2 },
  { id: 'reports', label: 'Reports & audit', icon: Gauge },
];

const statusStyles: Record<CaseStatus, string> = {
  imported: 'slate',
  assigned: 'blue',
  unable_to_recover: 'red',
  custody_review: 'amber',
  payment_pending: 'amber',
  payment_confirmed: 'green',
  release_pass_printed: 'violet',
  closed: 'slate',
  cancelled: 'slate',
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
  return <span className={`status-pill ${statusStyles[status]}`}><i />{caseStatusLabel(status)}</span>;
}

function openRowFromKeyboard(event: ReactKeyboardEvent<HTMLTableRowElement>, onOpen: () => void) {
  if (!isActivationKey(event.key)) return;
  event.preventDefault();
  onOpen();
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
  const [actionNotice, setActionNotice] = useState('');
  const [caseEvidence, setCaseEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [printPass, setPrintPass] = useState<ReleasePass | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [financeMembers, setFinanceMembers] = useState<FinanceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const unreadCount = appNotifications.filter((item) => !item.read).length;
  const activeCases = cases.filter((item) => !['imported', 'closed'].includes(item.status));
  const pendingReview = financeReviewCases(cases);
  const releaseReady = cases.filter((item) => item.status === 'payment_confirmed').length;
  const canViewReports = session.user.permissions.includes('report.export') || session.user.permissions.includes('audit.view');
  const visibleNavigation = navigation.filter((item) => item.id !== 'reports' || canViewReports);
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const monthLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

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

  useEffect(() => {
    if (page !== 'reports' || !session.user.permissions.includes('audit.view')) return;
    setAuditLoading(true);
    api.auditEvents(session.token).then(({ events }) => setAuditEvents(events)).catch((error) => setActionError(error instanceof Error ? error.message : 'Unable to load the audit trail.')).finally(() => setAuditLoading(false));
  }, [page, session.token]);

  useEffect(() => {
    if (page !== 'settings' || !session.user.permissions.includes('member.manage')) return;
    setMembersLoading(true);
    api.members(session.token).then(({ members }) => setFinanceMembers(members)).catch((error) => setActionError(error instanceof Error ? error.message : 'Unable to load finance users.')).finally(() => setMembersLoading(false));
  }, [page, session.token]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  async function importMonthlyRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    const snapshotMonth = String(formData.get('snapshotMonth') || '');
    if (!(file instanceof File) || !file.size || !snapshotMonth) return;
    try {
      setActionError('');
      setActionNotice('');
      const { result } = await api.importMonthly(session.token, file, `${snapshotMonth}-01`);
      await loadWorkspace();
      setPage('register');
      setDialog(null);
      setActionNotice(result.duplicate
        ? 'This file was already imported; no records changed.'
        : `${result.accepted} accounts processed: ${result.created} new, ${result.updated} updated${result.rejected ? `, ${result.rejected} rejected` : ''}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to import the register.'); }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(['accountNumber', 'borrowerName', 'borrowerMobile', 'borrowerAddress', 'registration', 'makeModel', 'vehicleType', 'chassis', 'branch', 'pendingAmount', 'overdueDays'].map((field) => [field, String(formData.get(field) || '')])) as unknown as AccountInput;
    try {
      setActionError('');
      setActionNotice('');
      const response = dialog === 'edit-account' && selectedCase
        ? await api.updateAccount(session.token, selectedCase.id, values)
        : await api.createAccount(session.token, values);
      await loadWorkspace();
      setSelectedCaseId(response.case.id);
      setPage('register');
      setDialog(null);
      setActionNotice(dialog === 'edit-account' ? 'Account details were updated.' : 'The account was added for finance review.');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to save this account.'); }
  }

  async function assignCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase) return;
    const formData = new FormData(event.currentTarget);
    const selectedAgentId = String(formData.get('agentId'));
    const assignmentNote = String(formData.get('assignmentNote') || '');
    const selectedAgent = agentList.find((item) => item.id === selectedAgentId);
    if (!selectedAgent) return;
    try {
      setActionError('');
      await api.assignCase(session.token, selectedCase.id, selectedAgent.id, assignmentNote);
      await loadWorkspace();
      setDialog(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to assign this case.'); }
  }

  async function createAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      setActionError('');
      setActionNotice('');
      const { agent } = await api.createAgent(session.token, {
        name: String(formData.get('name') || ''),
        mobile: String(formData.get('mobile') || ''),
        city: String(formData.get('city') || ''),
      });
      await loadWorkspace();
      setDialog(null);
      setActionNotice(`${agent.name} can now sign in with the registered mobile number.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to add this agent.'); }
  }

  async function changeAgentStatus(agent: Agent) {
    try {
      setActionError('');
      setActionNotice('');
      await api.setAgentActive(session.token, agent.id, agent.status !== 'Active');
      await loadWorkspace();
      setActionNotice(`${agent.name} was ${agent.status === 'Active' ? 'suspended' : 'reactivated'}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to change this agent.'); }
  }

  async function exportCaseReport() {
    try {
      setActionError('');
      const url = URL.createObjectURL(await api.caseReport(session.token));
      const link = document.createElement('a');
      link.href = url;
      link.download = `recovery-cases-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setActionNotice('The tenant case report was exported.');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to export the report.'); }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      setActionError('');
      setActionNotice('');
      const { member } = await api.createMember(session.token, { name: String(formData.get('name') || ''), mobile: String(formData.get('mobile') || ''), city: String(formData.get('city') || ''), role: String(formData.get('role') || '') });
      const response = await api.members(session.token);
      setFinanceMembers(response.members);
      setDialog(null);
      setActionNotice(`${member.name} can now sign in with OTP.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to add this finance user.'); }
  }

  async function changeMemberStatus(member: FinanceMember) {
    try {
      setActionError('');
      setActionNotice('');
      await api.setMemberActive(session.token, member.id, !member.active);
      const response = await api.members(session.token);
      setFinanceMembers(response.members);
      setActionNotice(`${member.name} was ${member.active ? 'suspended' : 'reactivated'}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to change this finance user.'); }
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
      setDialog(null);
      setActionNotice(`${selectedCase.id} was closed after the vehicle release was confirmed.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to close the case.'); }
  }

  function printReleasePass(pass: ReleasePass) {
    setPrintPass(pass);
    window.setTimeout(() => window.print(), 80);
  }

  const pageContent: Record<Page, ReactNode> = {
    dashboard: <Dashboard cases={cases} agentList={agentList} activeCases={activeCases} pendingReview={pendingReview} releaseReady={releaseReady} monthLabel={monthLabel} onSelectCase={setSelectedCaseId} onPageChange={setPage} />,
    register: <RegisterPage cases={visibleCases} monthLabel={monthLabel} onImport={() => setDialog('import')} onAdd={() => setDialog('account')} canManage={session.user.permissions.includes('account.manage')} onSelectCase={setSelectedCaseId} />,
    cases: <CasesPage cases={visibleCases} onSelectCase={setSelectedCaseId} />, 
    agents: <AgentsPage agents={agentList} cases={cases} canManage={session.user.permissions.includes('agent.manage')} onAdd={() => setDialog('agent')} onChangeStatus={changeAgentStatus} onSelectCase={setSelectedCaseId} />,
    custody: <CustodyPage custody={custody} cases={cases} onSelectCase={setSelectedCaseId} />, 
    releases: <ReleasesPage cases={cases} onSelectCase={setSelectedCaseId} />, 
    reports: <ReportsPage cases={cases} events={auditEvents} loading={auditLoading} canExport={session.user.permissions.includes('report.export')} onExport={exportCaseReport} />,
    notifications: <NotificationsPage items={appNotifications} onReadAll={async () => { await api.readNotifications(session.token); await loadWorkspace(); }} />, 
    settings: <SettingsPage members={financeMembers} loading={membersLoading} session={session} onAdd={() => setDialog('member')} onChangeStatus={changeMemberStatus} />,
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>handoff</span></div>
        <div className="workspace-label">{session.user.tenantName}</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {visibleNavigation.map(({ id, label, icon: Icon }) => <button key={id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'nav-link active' : 'nav-link'} onClick={() => { setPage(id); setMobileNavOpen(false); }}><Icon size={17} /> <span>{label}</span>{id === 'register' && <b>{cases.length}</b>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="security-note"><ShieldCheck size={16} /><div><strong>Tenant protected</strong><span>Audit trail is active</span></div></div>
        <button className={page === 'settings' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('settings')}><Settings size={17} /> <span>Settings</span></button>
        <button className="profile" onClick={onLogout} title="Sign out"><span className="avatar">{session.user.name.split(' ').map((word) => word[0]).join('')}</span><div><strong>{session.user.name}</strong><small>{session.user.role.replace('_', ' ')}</small></div><LogOut size={15} /></button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen((value) => !value)} aria-label="Toggle navigation"><Menu size={21} /></button>
          <div><p className="date-label">{dateLabel}</p><h1>{page === 'dashboard' ? `${greeting}, ${session.user.name.split(' ')[0]}` : visibleNavigation.find((item) => item.id === page)?.label ?? page}</h1></div>
          <div className="topbar-actions">
            <label className="search-box"><span className="sr-only">Search recovery cases</span><Search size={17} /><input ref={searchRef} aria-label="Search recovery cases" value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value && !['register', 'cases'].includes(page)) setPage('cases'); }} placeholder="Search cases, people, vehicles..." /><kbd>Ctrl K</kbd></label>
            <button className="notification-button" onClick={() => setPage('notifications')} aria-label="Open notifications"><Bell size={18} />{unreadCount > 0 && <b>{unreadCount}</b>}</button>
            {session.user.permissions.includes('import.manage') && <button className="primary-button" onClick={() => setDialog('import')}><Plus size={16} /> Import register</button>}
          </div>
        </header>
        <section className="content-area">{actionError && <div className="app-error" role="alert">{actionError}<button onClick={() => setActionError('')} aria-label="Dismiss error"><X size={14} /></button></div>}{actionNotice && <div className="app-notice" role="status">{actionNotice}<button onClick={() => setActionNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}{loading ? <div className="workspace-loading" role="status">Loading your tenant workspace…</div> : pageContent[page]}</section>
      </main>

      {selectedCase && <CaseDrawer caseItem={selectedCase} agentList={agentList} custody={custody.find((record) => record.id === selectedCase.custodyId)} evidence={caseEvidence} evidenceLoading={evidenceLoading} releasePass={releasePasses.find((pass) => pass.caseId === selectedCase.id)} session={session} onClose={() => { setSelectedCaseId(null); setDialog(null); }} onOpenDialog={setDialog} onPrint={printReleasePass} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onSubmit={importMonthlyRegister} />}
      {(dialog === 'account' || (dialog === 'edit-account' && selectedCase)) && <AccountDialog caseItem={dialog === 'edit-account' ? selectedCase ?? undefined : undefined} onClose={() => setDialog(null)} onSubmit={saveAccount} />}
      {dialog === 'agent' && <AgentDialog onClose={() => setDialog(null)} onSubmit={createAgent} />}
      {dialog === 'member' && <MemberDialog session={session} onClose={() => setDialog(null)} onSubmit={createMember} />}
      {dialog === 'authority' && selectedCase && <AuthorityDialog caseItem={selectedCase} onClose={() => setDialog(null)} onSubmit={approveAuthority} />}
      {dialog === 'assign' && selectedCase && <AssignDialog caseItem={selectedCase} agentList={agentList} onClose={() => setDialog(null)} onSubmit={assignCase} />}
      {dialog === 'custody-review' && selectedCase && <CustodyReviewDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={approveCustody} />}
      {dialog === 'payment' && selectedCase && <PaymentDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={clearPayment} />}
      {dialog === 'release' && selectedCase && <ReleaseDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={issueReleasePass} />}
      {dialog === 'close' && selectedCase && <CloseCaseDialog caseItem={selectedCase} onClose={() => setDialog(null)} onConfirm={closeCase} />}
      {printPass && <PrintableReleasePass pass={printPass} caseItem={cases.find((item) => item.id === printPass.caseId)} custody={custody.find((item) => item.id === printPass.custodyId)} tenantName={session.user.tenantName} />}
    </div>
  );
}

function Dashboard({ cases, agentList, activeCases, pendingReview, releaseReady, monthLabel, onSelectCase, onPageChange }: { cases: RecoveryCase[]; agentList: Agent[]; activeCases: RecoveryCase[]; pendingReview: RecoveryCase[]; releaseReady: number; monthLabel: string; onSelectCase: (id: string) => void; onPageChange: (page: Page) => void }) {
  const pendingAmount = activeCases.reduce((sum, item) => sum + item.pendingAmount, 0);
  const inField = cases.filter((item) => item.status === 'assigned');
  const activeBranches = new Set(activeCases.map((item) => item.branch)).size;
  const pipeline = recoveryPipeline(cases);
  return <>
    <div className="page-heading"><div><p className="eyebrow">Finance operations</p><h2>Recovery overview</h2></div><span className="date-control">{monthLabel}</span></div>
    <section className="metric-grid">
      <MetricCard icon={<ClipboardCheck size={19} />} label="Open recovery cases" value={activeCases.length.toString()} foot={`Across ${activeBranches} active branch${activeBranches === 1 ? '' : 'es'}`} tone="blue" />
      <MetricCard icon={<Clock3 size={19} />} label="Need finance review" value={pendingReview.length.toString()} foot="Imports and failed attempts" tone="amber" />
      <MetricCard icon={<Gauge size={19} />} label="Pending value" value={formatCurrency(pendingAmount)} foot="Across active recovery cases" tone="violet" />
      <MetricCard icon={<FileCheck2 size={19} />} label="Ready for release" value={releaseReady.toString()} foot="Payment confirmed by finance" tone="green" />
    </section>
    <section className="workflow-strip"><div><p className="eyebrow">Controlled operating flow</p><h3>Live cases at each recorded lifecycle stage.</h3></div><ol>{pipeline.map((stage) => <li className={stage.count ? 'current' : ''} key={stage.label}><span>{stage.count}</span>{stage.label}</li>)}</ol></section>
    <section className="dashboard-columns">
      <article className="card case-card"><CardHeading title="Active field work" description="Cases assigned to independent agents" action="View cases" onAction={() => onPageChange('cases')} />
        <div className="table-scroll"><table><thead><tr><th>Case</th><th>Vehicle</th><th>Assigned agent</th><th>Status</th><th /></tr></thead><tbody>{inField.map((item) => <tr key={item.id} className="row-action" role="button" tabIndex={0} aria-label={`Open case ${item.id} for ${item.borrower.name}`} onClick={() => onSelectCase(item.id)} onKeyDown={(event) => openRowFromKeyboard(event, () => onSelectCase(item.id))}><td><strong>{item.borrower.name}</strong><small>{item.id}</small></td><td>{item.vehicle.registration}<small>{item.vehicle.makeModel}</small></td><td>{agentName(agentList, item.assignedAgentId)}</td><td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      </article>
      <aside className="dashboard-side">
        <article className="card attention-card"><div className="attention-icon"><Bell size={18} /></div><p className="eyebrow">Action needed</p><h3>Review {pendingReview.length} case{pendingReview.length === 1 ? '' : 's'} before the next assignment.</h3><button onClick={() => onPageChange('register')}>Open monthly register <ChevronRight size={15} /></button></article>
        <article className="card activity-card"><CardHeading title="Recent activity" description="Latest finance and field updates" />{cases.slice(0, 4).map((item) => <div className="activity-row" key={item.id}><span className={`activity-dot ${statusStyles[item.status]}`}><Check size={11} /></span><div><p><strong>{item.id}</strong> · {caseStatusLabel(item.status)}</p><small>{item.updatedAt}</small></div></div>)}</article>
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

function RegisterPage({ cases, monthLabel, onImport, onAdd, canManage, onSelectCase }: { cases: RecoveryCase[]; monthLabel: string; onImport: () => void; onAdd: () => void; canManage: boolean; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">{monthLabel} loan cycle</p><h2>Monthly delinquency register</h2><p className="page-copy">Imported borrower and vehicle accounts are reviewed before they become recovery cases.</p></div><div className="heading-actions">{canManage && <button className="secondary-button" onClick={onAdd}><Plus size={15} /> Add one account</button>}<button className="primary-button" onClick={onImport}><Plus size={16} /> Import monthly file</button></div></div><section className="register-band"><div><strong>{cases.length}</strong><span>imported accounts</span></div><div><strong>{formatCurrency(cases.reduce((sum, item) => sum + item.pendingAmount, 0))}</strong><span>visible pending amount</span></div><div><strong>{cases.filter((item) => item.status === 'imported').length}</strong><span>awaiting first review</span></div><p>Only authorized finance users can view this borrower data.</p></section><CaseTable cases={cases} onSelectCase={onSelectCase} showLoan /> <section className="compliance-banner"><ShieldCheck size={18} /><p><strong>Finance control point.</strong> Importing an overdue account does not create recovery authority. Your finance team decides which cases are assigned.</p></section></>;
}

function CasesPage({ cases, onSelectCase }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  const [status, setStatus] = useState('All');
  const filtered = status === 'All' ? cases : cases.filter((item) => item.status === status);
  return <><div className="page-heading"><div><p className="eyebrow">Assigned and active work</p><h2>Recovery cases</h2><p className="page-copy">Open a case to assign an agent, review field evidence, or progress custody and release.</p></div><label className="status-filter">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option>{Array.from(new Set(cases.map((item) => item.status))).map((item) => <option key={item} value={item}>{caseStatusLabel(item)}</option>)}</select></label></div><CaseTable cases={filtered} onSelectCase={onSelectCase} showLoan /></>;
}

function CaseTable({ cases, onSelectCase, showLoan }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void; showLoan: boolean }) {
  return <article className="card data-card"><div className="table-scroll"><table className="case-table"><thead><tr><th>Borrower</th><th>Mobile</th><th>Vehicle</th><th>Registration</th>{showLoan && <th>Pending amount</th>}<th>Status</th><th /></tr></thead><tbody>{cases.length ? cases.map((item) => <tr key={item.id} className="row-action" role="button" tabIndex={0} aria-label={`Open case ${item.id} for ${item.borrower.name}`} onClick={() => onSelectCase(item.id)} onKeyDown={(event) => openRowFromKeyboard(event, () => onSelectCase(item.id))}><td><strong>{item.borrower.name}</strong><small>{item.id} · {item.branch}</small></td><td className="mono">{item.borrower.mobile}</td><td>{item.vehicle.makeModel}<small>{item.vehicle.type}</small></td><td className="mono">{item.vehicle.registration}</td>{showLoan && <td className="amount">{formatCurrency(item.pendingAmount)}<small>{item.overdueDays} days overdue</small></td>}<td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>) : <tr><td colSpan={showLoan ? 7 : 6}><div className="empty-table">No cases match this view.</div></td></tr>}</tbody></table></div></article>;
}

function AgentsPage({ agents, cases, canManage, onAdd, onChangeStatus, onSelectCase }: { agents: Agent[]; cases: RecoveryCase[]; canManage: boolean; onAdd: () => void; onChangeStatus: (agent: Agent) => void; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">External field workforce</p><h2>Seizure agents</h2><p className="page-copy">Independent agents only receive the cases your finance users assign to them.</p></div>{canManage && <button className="primary-button" onClick={onAdd}><Plus size={16} /> Add agent</button>}</div><section className="agent-grid">{agents.map((agent) => { const assigned = cases.filter((item) => item.assignedAgentId === agent.id && item.status !== 'closed'); return <article className="card agent-card" key={agent.id}><div className="agent-card-top"><span className="agent-avatar">{agent.name.split(' ').map((word) => word[0]).join('')}</span><span className={`agent-status ${agent.status === 'Active' ? 'good' : 'off'}`}>{agent.status}</span></div><h3>{agent.name}</h3><p>{agent.city} · {agent.mobile}</p><div className="agent-stats"><span><strong>{assigned.length}</strong>active cases</span><span><strong>{agent.completedThisMonth}</strong>completed this month</span></div><div className="agent-card-actions">{assigned.length > 0 && <button className="agent-case-link" onClick={() => onSelectCase(assigned[0].id)}>Open current case <ChevronRight size={14} /></button>}{canManage && <button className="text-button" disabled={agent.status === 'Active' && assigned.length > 0} title={agent.status === 'Active' && assigned.length > 0 ? 'Reassign or close active cases first' : ''} onClick={() => onChangeStatus(agent)}>{agent.status === 'Active' ? 'Suspend' : 'Reactivate'}</button>}</div></article>; })}</section></>;
}

function CustodyPage({ custody, cases, onSelectCase }: { custody: CustodyRecord[]; cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">Digital parking check slips</p><h2>Custody records</h2><p className="page-copy">A condition and handover record is created when an agent reports custody.</p></div></div><article className="card data-card"><div className="table-scroll"><table><thead><tr><th>Certificate</th><th>Vehicle / case</th><th>Parking location</th><th>Agent</th><th>Checklist</th><th /></tr></thead><tbody>{custody.length ? custody.map((item) => { const caseItem = cases.find((current) => current.id === item.caseId); return <tr className="row-action" role="button" tabIndex={0} aria-label={`Open custody certificate ${item.id}`} key={item.id} onClick={() => onSelectCase(item.caseId)} onKeyDown={(event) => openRowFromKeyboard(event, () => onSelectCase(item.caseId))}><td><strong className="token-id">{item.id}</strong><small>{item.createdAt}</small></td><td>{caseItem?.vehicle.registration}<small>{item.caseId} · {caseItem?.vehicle.makeModel}</small></td><td>{item.yardName}<small>{item.arrivalTime}</small></td><td>{item.agentName}</td><td><span className="checked-count"><Check size={12} /> {item.checklist}/{checklist.length}</span></td><td><ChevronRight size={17} /></td></tr>; }) : <tr><td colSpan={6}><div className="empty-table">No custody certificates have been submitted yet.</div></td></tr>}</tbody></table></div></article><section className="receipt-grid">{checklist.map((item) => <span key={item}><Check size={14} /> {item}</span>)}</section></>;
}

function ReleasesPage({ cases, onSelectCase }: { cases: RecoveryCase[]; onSelectCase: (id: string) => void }) {
  const releaseCases = cases.filter((item) => ['payment_confirmed', 'release_pass_printed', 'closed'].includes(item.status));
  return <><div className="page-heading"><div><p className="eyebrow">Financer-controlled customer handover</p><h2>Release passes</h2><p className="page-copy">A printable pass is issued only after a finance employee manually confirms payment.</p></div></div><article className="card data-card"><div className="table-scroll"><table><thead><tr><th>Customer</th><th>Vehicle</th><th>Payment status</th><th>Release pass</th><th>Current state</th><th /></tr></thead><tbody>{releaseCases.length ? releaseCases.map((item) => <tr className="row-action" role="button" tabIndex={0} aria-label={`Open release case ${item.id}`} onClick={() => onSelectCase(item.id)} onKeyDown={(event) => openRowFromKeyboard(event, () => onSelectCase(item.id))} key={item.id}><td><strong>{item.borrower.name}</strong><small>{item.borrower.mobile}</small></td><td>{item.vehicle.registration}<small>{item.vehicle.makeModel}</small></td><td><span className="checked-count"><Check size={12} /> Confirmed by finance</span></td><td className="token-id">{item.releasePassId ?? 'Not issued'}</td><td><StatusPill status={item.status} /></td><td><ChevronRight size={17} /></td></tr>) : <tr><td colSpan={6}><div className="empty-table">No customer release passes are ready yet.</div></td></tr>}</tbody></table></div></article><section className="release-process"><span>1. Financer confirms dues</span><ChevronRight size={16} /><span>2. Print release pass</span><ChevronRight size={16} /><span>3. Customer presents pass at parking yard</span><ChevronRight size={16} /><span>4. Financer closes case</span></section></>;
}

function ReportsPage({ cases, events, loading, canExport, onExport }: { cases: RecoveryCase[]; events: AuditEvent[]; loading: boolean; canExport: boolean; onExport: () => void }) {
  const pendingAmount = cases.filter((item) => !['payment_confirmed', 'release_pass_printed', 'closed'].includes(item.status)).reduce((sum, item) => sum + item.pendingAmount, 0);
  const fieldOutcomes = cases.filter((item) => ['unable_to_recover', 'custody_review', 'payment_pending', 'payment_confirmed', 'release_pass_printed', 'closed'].includes(item.status)).length;
  return <><div className="page-heading"><div><p className="eyebrow">Tenant reporting</p><h2>Reports and audit trail</h2><p className="page-copy">Export the current recovery register and review recent finance and field actions.</p></div>{canExport && <button className="primary-button" onClick={onExport}><FileText size={15} /> Export case CSV</button>}</div><section className="metric-grid"><MetricCard icon={<ClipboardCheck size={19} />} label="Total cases" value={cases.length.toString()} foot="Current tenant workspace" tone="blue" /><MetricCard icon={<Gauge size={19} />} label="Pending value" value={formatCurrency(pendingAmount)} foot="Excludes cleared and closed cases" tone="violet" /><MetricCard icon={<Check size={19} />} label="Field outcomes" value={fieldOutcomes.toString()} foot="Attempt or custody outcome recorded" tone="green" /><MetricCard icon={<ShieldCheck size={19} />} label="Audit events" value={events.length.toString()} foot="Latest 100 recorded actions" tone="amber" /></section><article className="card data-card"><div className="card-heading"><div><h3>Recent audit trail</h3><p>Tenant-scoped security and workflow events</p></div></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Case</th><th>Detail</th></tr></thead><tbody>{loading ? <tr><td colSpan={5}><div className="empty-table">Loading audit events…</div></td></tr> : events.length ? events.map((event) => <tr key={event.id}><td><strong>{new Date(event.createdAt).toLocaleDateString('en-IN')}</strong><small>{new Date(event.createdAt).toLocaleTimeString('en-IN')}</small></td><td>{event.actorName}</td><td><span className="token-id">{event.action}</span></td><td>{event.caseId ?? '—'}</td><td>{event.detail}</td></tr>) : <tr><td colSpan={5}><div className="empty-table">No audit events are available for this role.</div></td></tr>}</tbody></table></div></article></>;
}

function NotificationsPage({ items, onReadAll }: { items: AppNotification[]; onReadAll: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">Finance and field updates</p><h2>Notifications</h2><p className="page-copy">Assignments, field updates, custody records, payment confirmation, and release events.</p></div><button className="secondary-button" onClick={onReadAll}><Check size={15} /> Mark all read</button></div><article className="card notification-list">{items.map((item) => <div className={`notification-row ${item.read ? '' : 'unread'}`} key={item.id}><span className={`notification-icon ${item.tone}`}><Bell size={16} /></span><div><h3>{item.title}</h3><p>{item.detail}</p><small>{item.createdAt}</small></div>{!item.read && <i />}</div>)}</article></>;
}

function SettingsPage({ members, loading, session, onAdd, onChangeStatus }: { members: FinanceMember[]; loading: boolean; session: Session; onAdd: () => void; onChangeStatus: (member: FinanceMember) => void }) {
  const canManage = session.user.permissions.includes('member.manage');
  const canChange = (member: FinanceMember) => member.id !== session.user.id && member.role !== 'super_admin' && (session.user.role === 'super_admin' || member.role === 'finance_staff');
  return <><div className="page-heading"><div><p className="eyebrow">Finance company workspace</p><h2>Settings</h2><p className="page-copy">Manage finance-team access and review the security controls active for this tenant.</p></div>{canManage && <button className="primary-button" onClick={onAdd}><Plus size={15} /> Add finance user</button>}</div>{canManage && <article className="card data-card"><div className="card-heading"><div><h3>Finance users</h3><p>OTP identities and fixed responsibility templates</p></div></div><div className="table-scroll"><table><thead><tr><th>User</th><th>Mobile</th><th>City</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan={6}><div className="empty-table">Loading finance users…</div></td></tr> : members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong></td><td className="mono">{member.mobile}</td><td>{member.city}</td><td>{member.role.replace('_', ' ')}</td><td><span className={`agent-status ${member.active ? 'good' : 'off'}`}>{member.active ? 'Active' : 'Suspended'}</span></td><td>{canChange(member) && <button className="text-button" onClick={() => onChangeStatus(member)}>{member.active ? 'Suspend' : 'Reactivate'}</button>}</td></tr>)}</tbody></table></div></article>}<section className="settings-grid"><article className="card settings-card"><ShieldCheck size={20} /><h3>OTP and sessions</h3><p>Mobile OTP sign-in, hashed session tokens, expiry, logout revocation, and suspension revocation are active.</p></article><article className="card settings-card"><Bell size={20} /><h3>In-app notifications</h3><p>Assignments, failed attempts, custody submissions, payments, and release events are stored per tenant.</p></article><article className="card settings-card"><FileText size={20} /><h3>Loan-data sources</h3><p>CSV and XLSX monthly imports are active with immutable snapshots and duplicate-file detection.</p></article></section></>;
}

function CaseDrawer({ caseItem, agentList, custody, evidence, evidenceLoading, releasePass, session, onClose, onOpenDialog, onPrint }: { caseItem: RecoveryCase; agentList: Agent[]; custody?: CustodyRecord; evidence: EvidenceRecord[]; evidenceLoading: boolean; releasePass?: ReleasePass; session: Session; onClose: () => void; onOpenDialog: (dialog: DialogType) => void; onPrint: (pass: ReleasePass) => void }) {
  const assignedName = agentName(agentList, caseItem.assignedAgentId);
  const actionButton = () => {
    const action = financeCaseAction({ status: caseItem.status, hasAuthority: Boolean(caseItem.authority), hasCustody: Boolean(custody), hasReleasePass: Boolean(releasePass) }, session.user.permissions);
    if (action === 'authority') return <button className="primary-button full" onClick={() => onOpenDialog('authority')}><ShieldCheck size={16} /> Review recovery authority</button>;
    if (action === 'assign') return <button className="primary-button full" onClick={() => onOpenDialog('assign')}><UsersRound size={16} /> {caseItem.status === 'imported' ? 'Assign seizure agent' : 'Reassign case'}</button>;
    if (action === 'waiting-field') return <div className="field-waiting"><Clock3 size={16} /> Awaiting the assigned agent’s field update.</div>;
    if (action === 'waiting-custody') return <div className="field-waiting"><Clock3 size={16} /> Vehicle recovered; awaiting the agent’s custody certificate.</div>;
    if (action === 'custody-review') return <button className="primary-button full" onClick={() => onOpenDialog('custody-review')}><PackageCheck size={16} /> Review custody report</button>;
    if (action === 'payment') return <button className="primary-button full" onClick={() => onOpenDialog('payment')}><Check size={16} /> Confirm payment</button>;
    if (action === 'release') return <button className="primary-button full" onClick={() => onOpenDialog('release')}><FileCheck2 size={16} /> Create printable release pass</button>;
    if (action === 'print-close') return <div className="drawer-actions vertical"><button className="secondary-button" onClick={() => releasePass && onPrint(releasePass)}><Printer size={15} /> Print customer pass</button><button className="primary-button" onClick={() => onOpenDialog('close')}><Check size={16} /> Mark vehicle released and close</button></div>;
    if (action === 'closed') return <div className="closed-note"><Check size={15} /> Case closed</div>;
    return <div className="field-waiting"><ShieldCheck size={16} /> An authorised finance manager must complete the next step.</div>;
  };
  return <><div className="drawer-backdrop" onClick={onClose} /><aside className="case-drawer" role="dialog" aria-modal="true" aria-labelledby="case-drawer-title"><div className="drawer-top"><div><p className="eyebrow">{caseItem.id}</p><h2 id="case-drawer-title">{caseItem.borrower.name}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Close case details"><X size={18} /></button></div><StatusPill status={caseItem.status} />
    <div className="drawer-section"><p className="section-label">Borrower</p><div className="detail-list"><span><UsersRound size={14} /> {caseItem.borrower.mobile}</span><span><MapPin size={14} /> {caseItem.borrower.address}</span></div></div>
    <div className="drawer-section"><p className="section-label">Vehicle and loan</p><div className="vehicle-card"><span>{caseItem.vehicle.type === '2-wheeler' ? '2W' : '4W'}</span><div><strong>{caseItem.vehicle.registration}</strong><p>{caseItem.vehicle.makeModel}</p></div></div><dl className="detail-grid"><div><dt>Pending amount</dt><dd>{formatCurrency(caseItem.pendingAmount)}</dd></div><div><dt>Overdue</dt><dd>{caseItem.overdueDays} days</dd></div><div><dt>Loan account</dt><dd>{caseItem.accountNumber}</dd></div><div><dt>Chassis</dt><dd>{caseItem.vehicle.chassis}</dd></div></dl>{session.user.permissions.includes('account.manage') && caseItem.status === 'imported' && !caseItem.authority && <button className="text-button edit-account" onClick={() => onOpenDialog('edit-account')}>Edit account before approval <ChevronRight size={14} /></button>}</div>
    <div className="drawer-section"><p className="section-label">Recovery authority</p>{caseItem.authority ? <div className="payment-detail"><ShieldCheck size={16} /><div><strong>Approved by finance</strong><span>{caseItem.authority.documentName}</span><small>{new Date(caseItem.authority.approvedAt).toLocaleString()}</small></div></div> : <div className="evidence-empty">No authority document approved yet.</div>}</div>
    <div className="drawer-section"><p className="section-label">Assignment</p><div className="assignment-detail"><span className="agent-avatar small">{assignedName.split(' ').map((word) => word[0]).join('')}</span><div><strong>{assignedName}</strong><small>{caseItem.assignedAt ? new Date(caseItem.assignedAt).toLocaleString() : 'Waiting for finance assignment'}</small></div></div></div>
    {caseItem.failure && <div className="failure-note"><span>!</span><div><strong>{caseItem.failure.reason}</strong><p>{caseItem.failure.note}</p><small>{caseItem.failure.recordedAt}</small></div></div>}
    {(evidenceLoading || evidence.length > 0) && <EvidencePanel evidence={evidence} loading={evidenceLoading} token={session.token} />}
    {custody && <div className="drawer-section"><p className="section-label">Digital parking check slip</p><div className="custody-summary"><PackageCheck size={17} /><div><strong>{custody.id}</strong><p>{custody.yardName}</p><small>{custody.agentName} · ₹{custody.parkingRate}/day · {new Date(custody.arrivalTime).toLocaleString()}</small></div></div>{custody.inspection && <div className="inspection-summary">{Object.entries(custody.inspection).map(([item, condition]) => <span key={item}><strong>{item}</strong><small>{condition}</small></span>)}</div>}{custody.customNote && <p className="custody-agent-note"><strong>Agent note</strong>{custody.customNote}</p>}{custody.financeReviewedAt && <div className="payment-detail"><Check size={16} /><div><strong>Approved by finance</strong><span>{custody.financeReviewNote || 'Custody report accepted'}</span><small>{new Date(custody.financeReviewedAt).toLocaleString()}</small></div></div>}</div>}
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
  const titleId = useId();
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('keydown', closeOnEscape); previousFocus?.focus(); };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><div><p className="eyebrow">Finance-controlled workflow</p><h2 id={titleId}>{title}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button></div>{children}</section></div>;
}

function ImportDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  return <Modal title="Import monthly register" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">Upload the financer’s reviewed CSV or XLSX file. Existing open accounts are updated while every monthly snapshot remains in the audit history.</p><label className="field-label">Loan cycle month<input name="snapshotMonth" type="month" required defaultValue={currentMonth} /></label><label className="field-label">Monthly delinquency file<input name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label><p className="import-columns">Required columns: account number, borrower name, mobile, address, vehicle registration, make/model, vehicle type, pending amount, and overdue days.</p><label className="check-line"><input required type="checkbox" /> I confirm this file was reviewed by the finance company before import.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={15} /> Import accounts</button></div></form></Modal>;
}

function AccountDialog({ caseItem, onClose, onSubmit }: { caseItem?: RecoveryCase; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title={caseItem ? 'Edit imported account' : 'Add account manually'} onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">{caseItem ? 'Correct the borrower, vehicle, or loan details before approving recovery authority.' : 'Use this for a single reviewed exception instead of uploading a monthly file.'}</p><div className="form-two-col"><label className="field-label">Loan account<input name="accountNumber" required defaultValue={caseItem?.accountNumber} /></label><label className="field-label">Customer name<input name="borrowerName" required defaultValue={caseItem?.borrower.name} /></label><label className="field-label">Mobile number<input name="borrowerMobile" type="tel" required defaultValue={caseItem?.borrower.mobile} /></label><label className="field-label">Branch<input name="branch" required defaultValue={caseItem?.branch} /></label></div><label className="field-label">Customer address<textarea name="borrowerAddress" required defaultValue={caseItem?.borrower.address} /></label><div className="form-two-col"><label className="field-label">Registration number<input name="registration" required defaultValue={caseItem?.vehicle.registration} /></label><label className="field-label">Make / model<input name="makeModel" required defaultValue={caseItem?.vehicle.makeModel} /></label><label className="field-label">Vehicle type<select name="vehicleType" required defaultValue={caseItem?.vehicle.type ?? ''}><option value="" disabled>Select type</option><option value="2-wheeler">2-wheeler</option><option value="4-wheeler">4-wheeler</option></select></label><label className="field-label">Chassis number<input name="chassis" defaultValue={caseItem?.vehicle.chassis} /></label><label className="field-label">Pending amount (₹)<input name="pendingAmount" type="number" min="0" step="0.01" required defaultValue={caseItem?.pendingAmount} /></label><label className="field-label">Overdue days<input name="overdueDays" type="number" min="0" step="1" required defaultValue={caseItem?.overdueDays} /></label></div><label className="check-line"><input required type="checkbox" /> I verified these details against the finance company’s current account record.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check size={15} /> Save account</button></div></form></Modal>;
}

function AgentDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Add seizure agent" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">Register an independent field agent. This mobile number becomes their OTP sign-in identity for assigned work.</p><label className="field-label">Full name<input name="name" required minLength={2} maxLength={100} autoComplete="name" /></label><label className="field-label">Indian mobile number<input name="mobile" required type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" /></label><label className="field-label">Primary city<input name="city" required minLength={2} maxLength={100} autoComplete="address-level2" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><UsersRound size={15} /> Add agent</button></div></form></Modal>;
}

function MemberDialog({ session, onClose, onSubmit }: { session: Session; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Add finance user" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">Register a finance-team OTP identity. Managers handle operations; finance staff can maintain account intake only.</p><label className="field-label">Full name<input name="name" required minLength={2} maxLength={100} autoComplete="name" /></label><label className="field-label">Indian mobile number<input name="mobile" required type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" /></label><label className="field-label">Primary city<input name="city" required minLength={2} maxLength={100} autoComplete="address-level2" /></label><label className="field-label">Role<select name="role" required defaultValue="finance_staff"><option value="finance_staff">Finance staff — intake only</option>{session.user.role === 'super_admin' && <option value="finance_manager">Finance manager — operations and approvals</option>}</select></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><UsersRound size={15} /> Add finance user</button></div></form></Modal>;
}

function AssignDialog({ caseItem, agentList, onClose, onSubmit }: { caseItem: RecoveryCase; agentList: Agent[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Assign seizure agent" onClose={onClose}><form onSubmit={onSubmit}><p className="modal-copy">The selected independent agent will receive the full assigned-case information and an in-app notification.</p><div className="case-reference"><strong>{caseItem.id}</strong><span>{caseItem.vehicle.registration} · {caseItem.borrower.name}</span></div><label className="field-label">Select agent<select name="agentId" required defaultValue=""><option value="" disabled>Choose an active agent</option>{agentList.filter((agent) => agent.status === 'Active').map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.city} · {agent.activeCases} active cases</option>)}</select></label><label className="field-label">Assignment note<textarea name="assignmentNote" maxLength={2000} defaultValue={caseItem.assignmentNote} placeholder="Optional instruction for the assigned agent" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Send work order</button></div></form></Modal>;
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
  return <Modal title="Create printable release pass" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}><p className="modal-copy">Give this receipt to the customer after payment is confirmed. The parking yard can verify the printed details manually in version 1.</p><div className="release-pass-preview"><div><p>VEHICLE RELEASE PASS</p><strong>Generated securely</strong><span>{caseItem.vehicle.registration}</span></div><div className="qr-placeholder"><ShieldCheck size={18} /></div><small>Issued for {caseItem.borrower.name}<br />A unique pass ID and one-time verification code will be recorded.</small></div><label className="check-line"><input id="release-confirmation" required type="checkbox" /> I confirm payment clearance and customer details have been verified.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><FileCheck2 size={15} /> Generate pass</button></div></form></Modal>;
}

function CloseCaseDialog({ caseItem, onClose, onConfirm }: { caseItem: RecoveryCase; onClose: () => void; onConfirm: () => void }) {
  return <Modal title="Confirm vehicle release and close" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}><p className="modal-copy">Close this case only after the customer’s printed release pass has been checked and the vehicle handover has actually been completed.</p><div className="case-reference"><strong>{caseItem.releasePassId}</strong><span>{caseItem.vehicle.registration} · {caseItem.borrower.name}</span></div><label className="check-line"><input required type="checkbox" /> I confirm the vehicle was released against the recorded pass and this case can be closed.</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check size={15} /> Confirm release and close</button></div></form></Modal>;
}

export default App;
