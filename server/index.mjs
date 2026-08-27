import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAudit, addNotification, db, isoNow } from './db.mjs';
import { loadConfig } from './config.mjs';
import { validateCaseAction } from './case-actions.mjs';
import { runTransaction } from './sqlite-transaction.mjs';
import { isAllowedAuthorityDocument } from './file-validation.mjs';
import { createDevelopmentOtpService, createOtpService, normalizeIndiaMobile } from './otp-service.mjs';
import { requestSignInOtp, verifySignInOtp } from './otp-auth.mjs';
import { hashSessionToken } from './session-token.mjs';
import { PERMISSIONS, hasPermission, permissionsForRole } from '../shared/contracts.mjs';
import { normalizeImportRows, parseImportFile } from './import-parser.mjs';
import { importMonthlyRows } from './monthly-import.mjs';
import { createAgent, setAgentActive } from './agent-management.mjs';
import { createAccount, updateAccount } from './account-management.mjs';
import { casesToCsv } from './report-export.mjs';

const app = express();
const config = loadConfig();
const port = config.port;
const otpProvider = config.nodeEnv === 'production'
  ? createOtpService({ authKey: config.msg91AuthKey, templateId: config.msg91OtpTemplateId })
  : createDevelopmentOtpService(config.developmentOtpCode);
const appDirectory = dirname(fileURLToPath(import.meta.url));
const uploadDirectory = join(appDirectory, 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage: uploadStorage,
  limits: { files: 5, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, /^(image|video)\//.test(file.mimetype)),
});

const authorityUpload = multer({
  storage: uploadStorage,
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, /^(image\/(jpeg|png)|application\/pdf)$/.test(file.mimetype)),
});

const monthlyImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, /\.(csv|xlsx)$/i.test(file.originalname)),
});

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));

function apiUser(row) {
  return { id: row.id, tenantId: row.tenant_id, role: row.role, permissions: permissionsForRole(row.role), name: row.name, email: row.email, mobile: row.mobile, city: row.city, tenantName: row.tenant_name };
}

function mapCase(row) {
  return {
    id: row.id,
    accountNumber: row.account_number,
    borrower: { name: row.borrower_name, mobile: row.borrower_mobile, address: row.borrower_address },
    vehicle: { registration: row.registration, makeModel: row.make_model, chassis: row.chassis, type: row.vehicle_type },
    branch: row.branch,
    pendingAmount: row.pending_amount,
    overdueDays: row.overdue_days,
    status: row.status,
    assignedAgentId: row.assigned_agent_user_id ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    updatedAt: row.updated_at,
    custodyId: row.custody_id ?? undefined,
    failure: row.failure_reason ? { reason: row.failure_reason, note: row.failure_note, recordedAt: row.failure_recorded_at } : undefined,
    paymentCleared: Boolean(row.payment_cleared),
    paymentReference: row.payment_reference ?? undefined,
    paymentConfirmedAt: row.payment_confirmed_at ?? undefined,
    releasePassId: row.release_pass_id ?? undefined,
    authority: row.authority_approved_at ? {
      documentName: row.authority_document_original_name,
      approvedAt: row.authority_approved_at,
    } : undefined,
  };
}

function mapCustody(row) {
  return { id: row.id, caseId: row.case_id, vehicleCondition: 'Verified', yardName: row.yard_name, arrivalTime: row.arrival_time, parkingRate: row.parking_rate, createdAt: row.created_at, agentName: row.agent_name, checklist: row.checklist_count, inspection: row.inspection_json ? JSON.parse(row.inspection_json) : undefined, financeReviewedAt: row.finance_reviewed_at ?? undefined, financeReviewNote: row.finance_review_note ?? undefined };
}

function mapNotification(row) {
  return { id: row.id, title: row.title, detail: row.detail, createdAt: row.created_at, read: Boolean(row.read), tone: row.tone };
}

function mapEvidence(row) {
  return { id: row.id, caseId: row.case_id, originalName: row.original_name, mimeType: row.mime_type, byteSize: row.byte_size, latitude: row.latitude, longitude: row.longitude, capturedAt: row.captured_at, agentName: row.agent_name ?? undefined };
}

function mapAgent(row, activeCases = 0) {
  return { id: row.id, name: row.name, mobile: row.mobile, city: row.city, activeCases, completedThisMonth: 0, status: row.active ? 'Active' : 'Suspended' };
}

function mapReleasePass(row) {
  return { id: row.id, caseId: row.case_id, verificationCode: row.verification_code, issuedAt: row.issued_at, borrowerName: row.borrower_name, borrowerMobile: row.borrower_mobile, vehicleRegistration: row.vehicle_registration, vehicleModel: row.vehicle_model, custodyId: row.custody_id ?? undefined, paymentReference: row.payment_reference ?? undefined, issuedByName: row.issued_by_name ?? undefined };
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const user = db.prepare(`SELECT users.*, tenants.name AS tenant_name, auth_sessions.id AS session_id
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      JOIN tenants ON tenants.id = users.tenant_id
      WHERE auth_sessions.token_hash = ? AND auth_sessions.revoked_at IS NULL AND auth_sessions.expires_at > ? AND users.active = 1`).get(hashSessionToken(token), isoNow());
    if (!user) return res.status(401).json({ error: 'This user account is no longer active.' });
    req.user = apiUser(user);
    req.sessionId = user.session_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired.' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => hasPermission(req.user.permissions, permission) ? next() : res.status(403).json({ error: 'Your role cannot perform this action.' });
}

function caseForUser(id, user) {
  const row = db.prepare('SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?').get(id, user.tenantId);
  if (!row || (user.role === 'agent' && row.assigned_agent_user_id !== user.id)) return null;
  return row;
}

function requireAssignedCase(req, res, next) {
  const recoveryCase = caseForUser(req.params.id, req.user);
  if (!recoveryCase) return res.status(404).json({ error: 'Assigned recovery case not found.' });
  req.recoveryCase = recoveryCase;
  return next();
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || '');
    const result = await requestSignInOtp({ database: db, otpProvider, mobile, requestIp: req.ip });
    const user = db.prepare('SELECT * FROM users WHERE mobile_e164 = ?').get(normalizeIndiaMobile(mobile));
    addAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.otp_requested', detail: 'A sign-in OTP was requested.' });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTP could not be sent.';
    const status = /too many/i.test(message) ? 429 : /unavailable|rejected/i.test(message) ? 503 : 422;
    return res.status(status).json({ error: message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const result = await verifySignInOtp({
      database: db,
      otpProvider,
      challengeId: String(req.body?.challengeId || ''),
      mobile: String(req.body?.mobile || ''),
      code: String(req.body?.code || ''),
    });
    const user = db.prepare(`SELECT users.*, tenants.name AS tenant_name FROM users JOIN tenants ON tenants.id = users.tenant_id WHERE users.id = ?`).get(result.userId);
    addAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.login', detail: 'Signed in with a verified mobile OTP.' });
    return res.json({ token: result.token, user: apiUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTP verification failed.';
    const status = /unavailable/i.test(message) ? 503 : 401;
    return res.status(status).json({ error: status === 401 ? 'The OTP is invalid, expired, or already used.' : message });
  }
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(isoNow(), req.sessionId);
  addAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'auth.logout', detail: 'Signed out and revoked the active session.' });
  res.status(204).end();
});

app.get('/api/workspace', auth, (req, res) => {
  const agentScope = req.user.role === 'agent' ? ' AND assigned_agent_user_id = ?' : '';
  const caseRows = db.prepare(`SELECT * FROM recovery_cases WHERE tenant_id = ?${agentScope} ORDER BY updated_at DESC`).all(...(req.user.role === 'agent' ? [req.user.tenantId, req.user.id] : [req.user.tenantId]));
  const visibleCaseIds = caseRows.map((row) => row.id);
  const custodyRows = req.user.role === 'agent'
    ? (visibleCaseIds.length ? db.prepare(`SELECT * FROM custody_records WHERE tenant_id = ? AND case_id IN (${visibleCaseIds.map(() => '?').join(',')}) ORDER BY created_at DESC`).all(req.user.tenantId, ...visibleCaseIds) : [])
    : db.prepare('SELECT * FROM custody_records WHERE tenant_id = ? ORDER BY created_at DESC').all(req.user.tenantId);
  const agentRows = req.user.role === 'agent' ? [] : db.prepare(`SELECT id, name, mobile, city, active FROM users WHERE tenant_id = ? AND role = 'agent' ORDER BY name`).all(req.user.tenantId);
  const agentData = agentRows.map((agent) => mapAgent(agent, caseRows.filter((item) => item.assigned_agent_user_id === agent.id && item.status !== 'Closed').length));
  const notificationRows = db.prepare('SELECT * FROM notifications WHERE tenant_id = ? AND (recipient_user_id IS NULL OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT 50').all(req.user.tenantId, req.user.id);
  const releasePassRows = req.user.role === 'agent' ? [] : db.prepare(`SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.tenant_id = ? ORDER BY release_passes.issued_at DESC`).all(req.user.tenantId);
  res.json({ cases: caseRows.map(mapCase), custody: custodyRows.map(mapCustody), agents: agentData, notifications: notificationRows.map(mapNotification), releasePasses: releasePassRows.map(mapReleasePass) });
});

app.post('/api/agents', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), (req, res) => {
  try {
    const agent = createAgent({ database: db, tenantId: req.user.tenantId, values: req.body ?? {} });
    addAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent.created', detail: `${agent.name} was added as an independent field agent.` });
    return res.status(201).json({ agent: { ...agent, activeCases: 0, completedThisMonth: 0, status: 'Active' } });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The agent could not be added.' });
  }
});

app.put('/api/agents/:id/status', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(422).json({ error: 'Choose an active or suspended status.' });
  try {
    const agent = setAgentActive({ database: db, tenantId: req.user.tenantId, agentId: req.params.id, active: req.body.active });
    addAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: agent.active ? 'agent.reactivated' : 'agent.suspended', detail: `${agent.name} was ${agent.active ? 'reactivated' : 'suspended'}.` });
    return res.json({ agent: { ...agent, activeCases: 0, completedThisMonth: 0, status: agent.active ? 'Active' : 'Suspended' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent status could not be changed.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.post('/api/accounts', auth, requirePermission(PERMISSIONS.ACCOUNT_MANAGE), (req, res) => {
  try {
    const account = createAccount({ database: db, tenantId: req.user.tenantId, values: req.body ?? {} });
    addAudit({ tenantId: req.user.tenantId, caseId: account.id, actorUserId: req.user.id, action: 'account.created', detail: `Manual account ${account.accountNumber} was added for finance review.` });
    return res.status(201).json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?').get(account.id, req.user.tenantId)) });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The account could not be added.' });
  }
});

app.put('/api/accounts/:id', auth, requirePermission(PERMISSIONS.ACCOUNT_MANAGE), (req, res) => {
  try {
    const account = updateAccount({ database: db, tenantId: req.user.tenantId, caseId: req.params.id, values: req.body ?? {} });
    addAudit({ tenantId: req.user.tenantId, caseId: account.id, actorUserId: req.user.id, action: 'account.updated', detail: `Account ${account.accountNumber} details were corrected before authority approval.` });
    return res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?').get(account.id, req.user.tenantId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The account could not be updated.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.get('/api/reports/cases.csv', auth, requirePermission(PERMISSIONS.REPORT_EXPORT), (req, res) => {
  const rows = db.prepare(`SELECT recovery_cases.*, users.name AS agent_name
    FROM recovery_cases LEFT JOIN users ON users.id = recovery_cases.assigned_agent_user_id
    WHERE recovery_cases.tenant_id = ? ORDER BY recovery_cases.updated_at DESC`).all(req.user.tenantId);
  addAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'report.exported', detail: `Exported ${rows.length} tenant recovery cases.` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="recovery-cases-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(casesToCsv(rows));
});

app.get('/api/audit-events', auth, requirePermission(PERMISSIONS.AUDIT_VIEW), (req, res) => {
  const events = db.prepare(`SELECT audit_events.*, users.name AS actor_name
    FROM audit_events JOIN users ON users.id = audit_events.actor_user_id
    WHERE audit_events.tenant_id = ? ORDER BY audit_events.created_at DESC LIMIT 100`).all(req.user.tenantId);
  res.json({ events: events.map((event) => ({ id: event.id, caseId: event.case_id, actorName: event.actor_name, action: event.action, detail: event.detail, createdAt: event.created_at })) });
});

app.post('/api/imports/monthly', auth, requirePermission(PERMISSIONS.IMPORT_MANAGE), monthlyImportUpload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(422).json({ error: 'Upload one CSV or XLSX file.' });
  const snapshotMonth = String(req.body?.snapshotMonth || '');
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(snapshotMonth)) return res.status(422).json({ error: 'Choose a valid loan cycle month.' });
  let normalized;
  try {
    normalized = normalizeImportRows(await parseImportFile({ originalName: req.file.originalname, buffer: req.file.buffer }));
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The monthly file could not be read.' });
  }
  if (!normalized.valid.length) return res.status(422).json({ error: 'No valid accounts were found in the file.', errors: normalized.errors });
  try {
    const result = importMonthlyRows({
      database: db,
      tenantId: req.user.tenantId,
      actorUserId: req.user.id,
      snapshotMonth,
      fileName: req.file.originalname,
      fileSha256: createHash('sha256').update(req.file.buffer).digest('hex'),
      rows: normalized.valid,
      rejectedRows: normalized.errors.length,
    });
    addAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'import.completed', detail: `${req.file.originalname}: ${result.accepted} accepted, ${result.rejected} rejected.` });
    addNotification({ tenantId: req.user.tenantId, title: result.duplicate ? 'Monthly file already imported' : 'Monthly file imported', detail: `${result.accepted} account${result.accepted === 1 ? '' : 's'} processed for ${snapshotMonth.slice(0, 7)}.`, tone: result.rejected ? 'amber' : 'blue' });
    return res.status(result.duplicate ? 200 : 201).json({ result, errors: normalized.errors });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/cases/:id/authority-approval', auth, requirePermission(PERMISSIONS.AUTHORITY_APPROVE), (req, res, next) => {
  const caseRow = caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const error = validateCaseAction('approve_authority', caseRow, { hasDocument: true });
  if (error) return res.status(422).json({ error });
  req.recoveryCase = caseRow;
  return next();
}, authorityUpload.single('document'), (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'Attach the signed authority document as a PDF, JPG, or PNG.' });
  const approvedAt = isoNow();
  const fileBytes = readFileSync(req.file.path);
  if (!isAllowedAuthorityDocument(fileBytes, req.file.mimetype)) {
    unlinkSync(req.file.path);
    return res.status(422).json({ error: 'The authority document contents do not match a valid PDF, JPG, or PNG.' });
  }
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  db.prepare(`UPDATE recovery_cases SET authority_document_file_name = ?, authority_document_original_name = ?, authority_document_mime_type = ?, authority_document_byte_size = ?, authority_document_sha256 = ?, authority_approved_at = ?, authority_approved_by_user_id = ?, status = 'Imported', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, sha256, approvedAt, req.user.id, approvedAt, req.recoveryCase.id, req.user.tenantId);
  addAudit({ tenantId: req.user.tenantId, caseId: req.recoveryCase.id, actorUserId: req.user.id, action: 'authority.approved', detail: `Authority document ${req.file.originalname} approved for assignment.` });
  addNotification({ tenantId: req.user.tenantId, title: 'Recovery authority approved', detail: `${req.recoveryCase.id} is ready to assign.`, tone: 'green' });
  return res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?').get(req.recoveryCase.id, req.user.tenantId)) });
});

app.put('/api/cases/:id/assignment', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  const agentId = String(req.body?.agentId || '');
  const agent = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'agent' AND active = 1`).get(agentId, req.user.tenantId);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('assign', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  if (!agent) return res.status(422).json({ error: 'Choose an active agent from this finance company.' });
  const updatedAt = isoNow();
  db.prepare(`UPDATE recovery_cases SET status = 'Assigned', assigned_agent_user_id = ?, assigned_at = ?, updated_at = ?, failure_reason = NULL, failure_note = NULL, failure_recorded_at = NULL WHERE id = ? AND tenant_id = ?`).run(agent.id, updatedAt, updatedAt, caseRow.id, req.user.tenantId);
  addNotification({ tenantId: req.user.tenantId, recipientUserId: agent.id, title: 'New recovery case assigned', detail: `${caseRow.id} has been assigned to you by the finance team.`, tone: 'blue' });
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.assigned', detail: `Assigned to ${agent.name}.` });
  res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id)) });
});

app.post('/api/cases/:id/attempt', auth, requirePermission(PERMISSIONS.ATTEMPT_SUBMIT), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  const reason = String(req.body?.reason || 'Other');
  const note = String(req.body?.note || '').trim();
  if (!caseRow) return res.status(404).json({ error: 'Assigned recovery case not found.' });
  if (!note) return res.status(422).json({ error: 'A factual field note is required.' });
  const updatedAt = isoNow();
  db.prepare(`UPDATE recovery_cases SET status = 'Unable to recover', failure_reason = ?, failure_note = ?, failure_recorded_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(reason, note, updatedAt, updatedAt, caseRow.id, req.user.tenantId);
  addNotification({ tenantId: req.user.tenantId, title: 'Recovery attempt could not be completed', detail: `${caseRow.id} was marked ${reason.toLowerCase()} by ${req.user.name}.`, tone: 'amber' });
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const locationDetail = Number.isFinite(latitude) && Number.isFinite(longitude) ? ` GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.` : '';
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'attempt.failed', detail: `${reason}: ${note}${locationDetail}` });
  res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id)) });
});

app.post('/api/cases/:id/evidence', auth, requirePermission(PERMISSIONS.CUSTODY_SUBMIT), requireAssignedCase, upload.array('files', 5), (req, res) => {
  const files = req.files ?? [];
  if (!files.length) return res.status(422).json({ error: 'Capture at least one photo or video before uploading.' });
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const capturedAt = String(req.body?.capturedAt || isoNow());
  const insert = db.prepare('INSERT INTO evidence (id, tenant_id, case_id, agent_user_id, file_name, original_name, mime_type, byte_size, latitude, longitude, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const records = files.map((file) => {
    const id = `ev-${crypto.randomUUID()}`;
    insert.run(id, req.user.tenantId, req.recoveryCase.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size, Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null, capturedAt);
    return mapEvidence(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id));
  });
  addAudit({ tenantId: req.user.tenantId, caseId: req.recoveryCase.id, actorUserId: req.user.id, action: 'evidence.uploaded', detail: `${records.length} field evidence file(s) captured.` });
  res.status(201).json({ evidence: records });
});

app.get('/api/cases/:id/evidence', auth, (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const records = db.prepare('SELECT evidence.*, users.name AS agent_name FROM evidence JOIN users ON users.id = evidence.agent_user_id WHERE evidence.tenant_id = ? AND evidence.case_id = ? ORDER BY evidence.captured_at DESC').all(req.user.tenantId, caseRow.id);
  res.json({ evidence: records.map(mapEvidence) });
});

app.get('/api/evidence/:id/file', auth, (req, res) => {
  const evidence = db.prepare('SELECT * FROM evidence WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenantId);
  if (!evidence || !caseForUser(evidence.case_id, req.user)) return res.status(404).json({ error: 'Evidence file not found.' });
  res.type(evidence.mime_type).sendFile(join(uploadDirectory, evidence.file_name));
});

app.post('/api/cases/:id/custody', auth, requirePermission(PERMISSIONS.CUSTODY_SUBMIT), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  const yardName = String(req.body?.yardName || '').trim();
  const arrivalTime = String(req.body?.arrivalTime || '').trim();
  const parkingRate = Number(req.body?.parkingRate);
  const checklist = Number(req.body?.checklist || 0);
  const inspection = req.body?.inspection && typeof req.body.inspection === 'object' ? req.body.inspection : null;
  if (!caseRow) return res.status(404).json({ error: 'Assigned recovery case not found.' });
  const evidenceCount = db.prepare('SELECT COUNT(*) AS count FROM evidence WHERE tenant_id = ? AND case_id = ?').get(req.user.tenantId, caseRow.id).count;
  if (!yardName || !arrivalTime || !Number.isFinite(parkingRate) || checklist < 14 || !inspection || Object.keys(inspection).length < 14) return res.status(422).json({ error: 'Complete the parking handover and all condition checks first.' });
  if (evidenceCount < 1) return res.status(422).json({ error: 'At least one photo or video evidence record is required before custody submission.' });
  const id = `CT-${String(Date.now()).slice(-8)}`;
  const createdAt = isoNow();
  db.prepare('INSERT INTO custody_records (id, tenant_id, case_id, yard_name, arrival_time, parking_rate, created_at, agent_name, checklist_count, inspection_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, req.user.tenantId, caseRow.id, yardName, arrivalTime, parkingRate, createdAt, req.user.name, checklist, JSON.stringify(inspection));
  db.prepare(`UPDATE recovery_cases SET status = 'Custody review', custody_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(id, createdAt, caseRow.id, req.user.tenantId);
  addNotification({ tenantId: req.user.tenantId, title: 'Custody report submitted', detail: `${caseRow.id} was submitted by ${req.user.name} and is awaiting finance review.`, tone: 'green' });
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const locationDetail = Number.isFinite(latitude) && Number.isFinite(longitude) ? ` GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.` : '';
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.created', detail: `Created ${id} at ${yardName}.${locationDetail}` });
  res.status(201).json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id)), custody: mapCustody(db.prepare('SELECT * FROM custody_records WHERE id = ?').get(id)) });
});

app.post('/api/cases/:id/custody-review', auth, requirePermission(PERMISSIONS.CUSTODY_REVIEW), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('approve_custody', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const custody = db.prepare('SELECT * FROM custody_records WHERE tenant_id = ? AND case_id = ?').get(req.user.tenantId, caseRow.id);
  if (!custody) return res.status(422).json({ error: 'A submitted custody report is required.' });
  const reviewedAt = isoNow();
  const note = String(req.body?.note || '').trim();
  runTransaction(db, () => {
    db.prepare('UPDATE custody_records SET finance_reviewed_at = ?, finance_reviewed_by_user_id = ?, finance_review_note = ? WHERE id = ? AND tenant_id = ?').run(reviewedAt, req.user.id, note || null, custody.id, req.user.tenantId);
    db.prepare(`UPDATE recovery_cases SET status = 'Payment pending', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(reviewedAt, caseRow.id, req.user.tenantId);
    addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.approved', detail: note || 'Finance approved the custody report.' });
  });
  addNotification({ tenantId: req.user.tenantId, title: 'Custody report approved', detail: `${caseRow.id} can proceed to payment confirmation.`, tone: 'green' });
  return res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?').get(caseRow.id, req.user.tenantId)) });
});

app.post('/api/cases/:id/payment-confirmation', auth, requirePermission(PERMISSIONS.PAYMENT_CONFIRM), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  const reference = String(req.body?.reference || '').trim();
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('confirm_payment', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  if (!reference) return res.status(422).json({ error: 'Payment reference is required.' });
  const updatedAt = isoNow();
  db.prepare(`UPDATE recovery_cases SET status = 'Payment confirmed', payment_cleared = 1, payment_reference = ?, payment_confirmed_at = ?, payment_confirmed_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(reference, updatedAt, req.user.id, updatedAt, caseRow.id, req.user.tenantId);
  addNotification({ tenantId: req.user.tenantId, title: 'Payment confirmed', detail: `${caseRow.id} is ready for a printable customer release pass.`, tone: 'green' });
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'payment.confirmed', detail: `Manual finance reference: ${reference}` });
  res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id)) });
});

app.post('/api/cases/:id/release-pass', auth, requirePermission(PERMISSIONS.RELEASE_ISSUE), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('issue_release', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const existingPass = db.prepare('SELECT * FROM release_passes WHERE tenant_id = ? AND case_id = ?').get(req.user.tenantId, caseRow.id);
  if (existingPass) return res.json({ case: mapCase(caseRow), releasePass: mapReleasePass(existingPass) });
  const passId = `RP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const verificationCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const updatedAt = isoNow();
  db.prepare(`UPDATE recovery_cases SET status = 'Release pass printed', release_pass_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(passId, updatedAt, caseRow.id, req.user.tenantId);
  db.prepare(`INSERT INTO release_passes (id, tenant_id, case_id, issued_by_user_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model, custody_id, payment_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(passId, req.user.tenantId, caseRow.id, req.user.id, verificationCode, updatedAt, caseRow.borrower_name, caseRow.borrower_mobile, caseRow.registration, caseRow.make_model, caseRow.custody_id, caseRow.payment_reference);
  addNotification({ tenantId: req.user.tenantId, title: 'Release pass issued', detail: `${passId} is ready to print for ${caseRow.borrower_name}.`, tone: 'green' });
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'release_pass.issued', detail: `Issued ${passId}.` });
  const updatedCase = db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id);
  const releasePass = db.prepare(`SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.id = ?`).get(passId);
  res.json({ case: mapCase(updatedCase), releasePass: mapReleasePass(releasePass) });
});

app.post('/api/cases/:id/close', auth, requirePermission(PERMISSIONS.RELEASE_CLOSE), (req, res) => {
  const caseRow = caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('close', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  db.prepare(`UPDATE recovery_cases SET status = 'Closed', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(isoNow(), caseRow.id, req.user.tenantId);
  addAudit({ tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.closed', detail: 'Finance user recorded final release and closure.' });
  res.json({ case: mapCase(db.prepare('SELECT * FROM recovery_cases WHERE id = ?').get(caseRow.id)) });
});

app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE tenant_id = ? AND (recipient_user_id IS NULL OR recipient_user_id = ?)').run(req.user.tenantId, req.user.id);
  res.status(204).end();
});

const distDirectory = join(appDirectory, '..', 'dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(join(distDirectory, 'index.html')));
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(422).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file must be 10 MB or smaller.' : 'The upload could not be accepted.' });
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, '127.0.0.1', () => console.log(`Seizer API listening on http://127.0.0.1:${port}`));
