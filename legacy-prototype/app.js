const initialCases = [
  { id: 'RP-2041', customer: 'Maya Hernandez', vehicle: '2022 Toyota Camry SE', status: 'review', due: 'Review due today', color: 'soft-amber' },
  { id: 'RP-2038', customer: 'Daniel Okafor', vehicle: '2021 Ford F-150 XLT', status: 'notice', due: 'Notice due in 1 day', color: 'soft-red' },
  { id: 'RP-2034', customer: 'Sarah Chen', vehicle: '2023 Honda CR-V EX', status: 'assigned', due: 'Follow-up Aug 8', color: 'soft-blue' },
  { id: 'RP-2029', customer: 'Jordan Williams', vehicle: '2020 Nissan Altima SR', status: 'review', due: 'Insurance check overdue', color: 'soft-amber', overdue: true },
  { id: 'RP-2025', customer: 'Amir Patel', vehicle: '2022 Hyundai Tucson SEL', status: 'ready', due: 'Checks complete', color: 'soft-green' },
];

const register = [
  { id: 'RP-2041', customer: 'Maya Hernandez', mobile: '+91 98450 21876', vehicle: '2022 Toyota Camry SE', registration: 'KA 05 AB 3410', pending: '₹68,400', status: 'review' },
  { id: 'RP-2038', customer: 'Daniel Okafor', mobile: '+91 98872 61049', vehicle: '2021 Ford F-150 XLT', registration: 'KA 03 CV 9814', pending: '₹1,24,000', status: 'notice' },
  { id: 'RP-2034', customer: 'Sarah Chen', mobile: '+91 97411 82065', vehicle: '2023 Honda CR-V EX', registration: 'KA 01 MN 4821', pending: '₹52,750', status: 'approved' },
  { id: 'RP-2029', customer: 'Jordan Williams', mobile: '+91 99017 45291', vehicle: '2020 Nissan Altima SR', registration: 'KA 51 DB 2007', pending: '₹86,200', status: 'review' },
  { id: 'RP-2025', customer: 'Amir Patel', mobile: '+91 98110 77349', vehicle: '2022 Hyundai Tucson SEL', registration: 'KA 03 KL 7654', pending: '₹77,900', status: 'approved' },
  { id: 'RP-2019', customer: 'Riya Nair', mobile: '+91 99808 37040', vehicle: '2021 Hero Splendor Plus', registration: 'KA 02 JE 9275', pending: '₹18,650', status: 'notice' },
];

let cases = [...initialCases];
let assignments = [
  { id: 'RP-2034', customer: 'Sarah Chen', vehicle: '2023 Honda CR-V EX', registration: 'KA 01 MN 4821', partner: 'Orbit Recovery', expiry: 'Aug 08 · 18:00', color: 'soft-blue' },
  { id: 'RP-2025', customer: 'Amir Patel', vehicle: '2022 Hyundai Tucson SEL', registration: 'KA 03 KL 7654', partner: 'SecureTow Services', expiry: 'Aug 07 · 16:30', color: 'soft-green' },
];
let tokens = [
  { id: 'CT-26-0817', caseId: 'RP-2013', customer: 'Neha Kapoor', vehicle: '2021 TVS Ntorq 125', registration: 'KA 04 RN 3109', storage: 'South Yard 2', partner: 'Orbit Recovery', status: 'Client notified' },
  { id: 'CT-26-0813', caseId: 'RP-2004', customer: 'Rohan Das', vehicle: '2022 Maruti Suzuki Baleno', registration: 'KA 01 QZ 9182', storage: 'North Gate Storage', partner: 'SecureTow Services', status: 'Payment pending' },
  { id: 'CT-26-0808', caseId: 'RP-1996', customer: 'Nisha Balan', vehicle: '2020 Bajaj Pulsar NS160', registration: 'KA 05 PH 6428', storage: 'South Yard 2', partner: 'Orbit Recovery', status: 'Release eligible' },
];
let releases = [
  { id: 'release-1', customer: 'Nisha Balan', vehicle: '2020 Bajaj Pulsar NS160', registration: 'KA 05 PH 6428', payment: 'Cleared Aug 03', token: 'CT-26-0808', storage: 'South Yard 2', released: false },
  { id: 'release-2', customer: 'Karan Mehta', vehicle: '2021 Tata Nexon XZ+', registration: 'KA 01 UU 5031', payment: 'Cleared Aug 04', token: 'CT-26-0803', storage: 'North Gate Storage', released: false },
  { id: 'release-3', customer: 'Aditya Rao', vehicle: '2022 Honda Activa 6G', registration: 'KA 02 EH 0872', payment: 'Cleared Aug 01', token: 'CT-26-0729', storage: 'East Yard', released: true },
];

const statuses = { review: 'Needs compliance review', notice: 'Notice required', assigned: 'Assigned to partner', ready: 'Checks complete' };
const registerLabels = { review: 'Compliance review', notice: 'Notice required', approved: 'Assignment eligible', released: 'Released' };
const pageTitles = { dashboard: 'Good morning, Alex', delinquencies: 'Monthly delinquency register', assignments: 'Field assignments', tokens: 'Custody tokens', releases: 'Release desk', reports: 'Reports', settings: 'Settings' };
let activeFilter = 'all';
let searchTerm = '';
let toastTimeout;

const caseList = document.querySelector('#caseList');
const searchInput = document.querySelector('#searchCases');
const caseDialog = document.querySelector('#caseDialog');
const tokenDialog = document.querySelector('#tokenDialog');
const releaseDialog = document.querySelector('#releaseDialog');

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function visibleCases() {
  return cases.filter((item) => {
    const matchesFilter = activeFilter === 'all' || item.status === activeFilter;
    const query = searchTerm.toLowerCase();
    const matchesSearch = !query || [item.id, item.customer, item.vehicle].some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  });
}

function renderCases() {
  const filtered = visibleCases();
  caseList.innerHTML = filtered.length ? filtered.map((item) => `
    <article class="case-row" tabindex="0" data-case="${escapeHTML(item.id)}" aria-label="Open ${escapeHTML(item.id)}, ${escapeHTML(item.customer)}">
      <span class="case-icon ${item.color}">${escapeHTML(item.vehicle.split(' ')[0].slice(-2))}</span>
      <div><p class="case-name">${escapeHTML(item.customer)}</p><p class="case-meta">${escapeHTML(item.id)} · ${escapeHTML(item.vehicle)}</p></div>
      <div class="case-status status-${item.status}"><span></span>${statuses[item.status]}</div>
      <div class="case-due ${item.overdue ? 'overdue' : ''}">${escapeHTML(item.due)}</div><span class="row-arrow">›</span>
    </article>`).join('') : '<p class="empty-cases">No cases match this view.</p>';
}

function renderRegister() {
  const query = document.querySelector('#registerSearch').value.trim().toLowerCase();
  const view = register.filter((item) => !query || Object.values(item).some((value) => value.toLowerCase().includes(query)));
  document.querySelector('#registerTable').innerHTML = view.map((item) => `
    <tr><td><strong>${escapeHTML(item.customer)}</strong><span class="mobile-value">${escapeHTML(item.id)}</span></td><td class="mobile-value">${escapeHTML(item.mobile)}</td><td>${escapeHTML(item.vehicle)}</td><td class="mobile-value">${escapeHTML(item.registration)}</td><td class="amount">${escapeHTML(item.pending)}</td><td><span class="small-badge ${item.status}"><i></i>${registerLabels[item.status]}</span></td><td>${item.status === 'approved' ? `<button class="table-action assignment-request" data-id="${escapeHTML(item.id)}">Send work order</button>` : '<span class="mobile-value">Review required</span>'}</td></tr>`).join('');
}

function renderAssignments() {
  const target = document.querySelector('#assignmentList');
  target.innerHTML = assignments.map((item) => `
    <article class="assignment-row"><span class="case-icon ${item.color}">${escapeHTML(item.vehicle.split(' ')[0].slice(-2))}</span><div><strong>${escapeHTML(item.id)} · ${escapeHTML(item.customer)}</strong><p>${escapeHTML(item.vehicle)} · ${escapeHTML(item.registration)}</p></div><div class="assignment-info">Recovery partner<strong>${escapeHTML(item.partner)}</strong></div><div class="assignment-info">Authority expires<strong>${escapeHTML(item.expiry)}</strong></div><button class="assignment-action" data-work-order="${escapeHTML(item.id)}">View order</button></article>`).join('') || '<p class="empty-cases">No authorized field assignments yet.</p>';
}

function renderTokens() {
  document.querySelector('#tokenList').innerHTML = tokens.map((item) => `
    <article class="token-row"><span class="token-visual">◇</span><div><h4>${escapeHTML(item.id)}</h4><p>${escapeHTML(item.caseId)} · ${escapeHTML(item.vehicle)} · ${escapeHTML(item.registration)}</p></div><div class="token-detail">Storage<strong>${escapeHTML(item.storage)}</strong></div><div class="token-detail">Status<strong>${escapeHTML(item.status)}</strong></div><button class="token-action" data-token="${escapeHTML(item.id)}">View token</button></article>`).join('');
  document.querySelector('#tokenCount').textContent = `${tokens.length} active`;
}

function renderReleases() {
  document.querySelector('#releaseTable').innerHTML = releases.map((item) => `
    <tr><td><strong>${escapeHTML(item.customer)}</strong></td><td><strong>${escapeHTML(item.vehicle)}</strong><span class="mobile-value">${escapeHTML(item.registration)}</span></td><td><span class="small-badge ${item.released ? 'released' : 'approved'}"><i></i>${item.released ? 'Released' : escapeHTML(item.payment)}</span></td><td class="mobile-value">${escapeHTML(item.token)}</td><td>${escapeHTML(item.storage)}</td><td>${item.released ? '<span class="mobile-value">Audit complete</span>' : `<button class="table-action verify-release" data-id="${escapeHTML(item.id)}">Verify & release</button>`}</td></tr>`).join('');
}

function updateCounts() {
  const reviewCount = cases.filter((item) => item.status === 'review').length;
  const noticeCount = cases.filter((item) => item.status === 'notice').length;
  document.querySelector('#activeCaseMetric').textContent = cases.length + 19;
  document.querySelector('#reviewMetric').textContent = reviewCount + 5;
  document.querySelector('#deadlineMetric').textContent = noticeCount + 2;
  document.querySelector('#caseCount').textContent = cases.length + 19;
  document.querySelector('#allFilterCount').textContent = cases.length + 19;
  document.querySelector('#reviewFilterCount').textContent = reviewCount + 5;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove('visible'), 3500);
}

function showPage(pageName) {
  document.querySelectorAll('.app-page').forEach((page) => { page.hidden = page.id !== pageName; });
  document.querySelectorAll('.nav-item[data-section]').forEach((item) => item.classList.toggle('active', item.dataset.section === pageName));
  document.querySelector('#pageTitle').textContent = pageTitles[pageName] || pageName;
  document.querySelector('.sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.filter-chip').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip === button));
    renderCases();
  });
});

searchInput.addEventListener('input', (event) => {
  searchTerm = event.target.value.trim(); activeFilter = 'all';
  document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.filter === 'all'));
  renderCases();
});
document.querySelector('#registerSearch').addEventListener('input', renderRegister);

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
  if (event.key === 'Escape') document.querySelector('.sidebar').classList.remove('open');
});

document.querySelector('#newCaseButton').addEventListener('click', () => caseDialog.showModal());
document.querySelector('#newCaseForm').addEventListener('submit', (event) => {
  const form = event.currentTarget;
  if (!form.checkValidity()) return;
  event.preventDefault();
  const data = new FormData(form);
  cases.unshift({ id: data.get('reference').toUpperCase(), customer: data.get('customer'), vehicle: data.get('vehicle'), status: data.get('status'), due: data.get('status') === 'notice' ? 'Notice timeline to confirm' : 'Review required', color: data.get('status') === 'notice' ? 'soft-red' : 'soft-amber' });
  form.reset(); caseDialog.close(); activeFilter = 'all';
  document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.filter === 'all'));
  updateCounts(); renderCases(); showToast('Case created and queued for compliance review.');
});

caseList.addEventListener('click', (event) => { const row = event.target.closest('.case-row'); if (row) showToast(`${row.dataset.case} will open in the detailed case view in the next iteration.`); });
caseList.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') event.target.click(); });
document.querySelector('#viewAllButton').addEventListener('click', () => { activeFilter = 'all'; searchTerm = ''; searchInput.value = ''; document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.filter === 'all')); renderCases(); document.querySelector('#cases').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.querySelector('#dateFilter').addEventListener('click', () => showToast('Date range selector is ready to connect to live reporting data.'));
document.querySelector('#reviewChecksButton').addEventListener('click', () => { document.querySelector('[data-filter="review"]').click(); document.querySelector('#cases').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.querySelector('#dismissLegalNote').addEventListener('click', (event) => event.currentTarget.parentElement.remove());
document.querySelector('#menuButton').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

document.querySelectorAll('.nav-item[data-section]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); showPage(link.dataset.section); }));
document.querySelector('#exportRegisterButton').addEventListener('click', () => showToast('Export would be role-gated and audit logged in the production app.'));
document.querySelector('#importRegisterButton').addEventListener('click', () => showToast('Monthly import is the next backend integration point.')); 
document.querySelector('#newAssignmentButton').addEventListener('click', () => { showPage('delinquencies'); showToast('Choose an assignment-eligible account and send an approved work order.'); });
document.querySelector('#releaseAuditButton').addEventListener('click', () => showToast('Release audit filtering is ready for the next iteration.'));

document.querySelector('#registerTable').addEventListener('click', (event) => {
  const button = event.target.closest('.assignment-request');
  if (!button) return;
  const account = register.find((item) => item.id === button.dataset.id);
  if (assignments.some((item) => item.id === account.id)) { showToast(`${account.id} is already in the field assignment inbox.`); return; }
  assignments.unshift({ ...account, partner: 'Orbit Recovery', expiry: 'Aug 08 · 18:00', color: 'soft-blue' });
  renderAssignments();
  showToast(`Approved work order for ${account.id} sent to the assigned partner device.`);
});
document.querySelector('#assignmentList').addEventListener('click', (event) => { const button = event.target.closest('[data-work-order]'); if (button) showToast(`${button.dataset.workOrder}: limited field view only; authority and stop conditions are shown.`); });

document.querySelector('#createTokenButton').addEventListener('click', () => tokenDialog.showModal());
document.querySelector('#tokenForm').addEventListener('submit', (event) => {
  const form = event.currentTarget;
  if (!form.checkValidity()) return;
  event.preventDefault();
  const data = new FormData(form);
  const [caseId, customer, vehicle, registration] = data.get('case').split('|');
  const tokenNumber = String(tokens.length + 18).padStart(4, '0');
  tokens.unshift({ id: `CT-26-${tokenNumber}`, caseId, customer, vehicle, registration, storage: data.get('storage'), partner: data.get('partner'), status: 'Client notification queued' });
  form.reset(); tokenDialog.close(); renderTokens(); showToast(`Custody token CT-26-${tokenNumber} created. Client notification queued with evidence record.`);
});
document.querySelector('#tokenList').addEventListener('click', (event) => { const button = event.target.closest('[data-token]'); if (button) showToast(`${button.dataset.token}: receipt view includes vehicle details, evidence, storage, and audit events.`); });

document.querySelector('#releaseTable').addEventListener('click', (event) => {
  const button = event.target.closest('.verify-release');
  if (!button) return;
  const release = releases.find((item) => item.id === button.dataset.id);
  document.querySelector('#releaseId').value = release.id;
  document.querySelector('#releaseTokenCode').textContent = release.token;
  document.querySelector('#releaseVehicle').textContent = `${release.vehicle} · ${release.registration}`;
  releaseDialog.showModal();
});
document.querySelector('#releaseForm').addEventListener('submit', (event) => {
  const form = event.currentTarget;
  if (!form.checkValidity()) return;
  event.preventDefault();
  const release = releases.find((item) => item.id === new FormData(form).get('releaseId'));
  release.released = true; form.reset(); releaseDialog.close(); renderReleases(); showToast(`${release.token} verified. Release completed and audit event recorded.`);
});

renderCases();
renderRegister();
renderAssignments();
renderTokens();
renderReleases();
updateCounts();
