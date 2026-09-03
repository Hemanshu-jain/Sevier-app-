import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, query, queryOne, tx } from './mysql.mjs';
import { seedDevData } from './seed-dev.mjs';
import { loadConfig } from './config.mjs';
import { validateCaseAction } from './case-actions.mjs';
import { isAllowedAuthorityDocument, isAllowedEvidenceFile } from './file-validation.mjs';
import { createDevelopmentOtpService, createOtpService, normalizeIndiaMobile } from './otp-service.mjs';
import { requestSignInOtp, verifySignInOtp } from './otp-auth.mjs';
import { hashSessionToken } from './session-token.mjs';
import { PERMISSIONS, hasPermission, permissionsForRole } from '../shared/contracts.mjs';
import { normalizeImportRows, parseImportFile } from './import-parser.mjs';
import { importMonthlyRows } from './monthly-import.mjs';
import { createAgent, setAgentActive } from './agent-management.mjs';
import { createAccount, updateAccount } from './account-management.mjs';
import { casesToCsv } from './report-export.mjs';
import { createFinanceMember, setFinanceMemberActive } from './member-management.mjs';
import { validateAttempt, validateCustody, validateFieldCase } from './field-validation.mjs';
import { persistCustody, persistReleasePass } from './workflow-persistence.mjs';
import { readFieldMutation, saveFieldMutation, validateIdempotencyKey } from './field-mutations.mjs';
import { listNotifications, markNotificationsRead } from './notification-access.mjs';
import { createReleaseSigner } from './release-signing.mjs';

const app = express();
const config = loadConfig();
const port = config.port;
const pool = createPool(config.databaseUrl);
const otpProvider = config.nodeEnv === 'production'
  ? createOtpService({ authKey: config.msg91AuthKey, templateId: config.msg91OtpTemplateId })
  : createDevelopmentOtpService(config.developmentOtpCode);
const releaseSigner = createReleaseSigner({ privateKey: config.releaseSigningPrivateKey, publicKey: config.releaseSigningPublicKey, keyId: config.releaseSigningKeyId });
const RELEASE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // ponytail: 90-day pass validity; make it configurable if a real retention policy appears
const maskRegistration = (reg) => String(reg || '').replace(/.(?=.{4})/g, '•');
const appDirectory = dirname(fileURLToPath(import.meta.url));
const uploadDirectory = join(appDirectory, 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

const isoNow = () => new Date().toISOString();
const parseJson = (value) => (value == null ? undefined : typeof value === 'string' ? JSON.parse(value) : value);

async function addAudit(executor, { tenantId, caseId = null, actorUserId, action, detail }) {
  await query(executor, 'INSERT INTO audit_events (tenant_id, case_id, actor_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)', [tenantId, caseId, actorUserId, action, detail, isoNow()]);
}

async function addNotification(executor, { tenantId, recipientUserId = null, caseId = null, title, detail, tone }) {
  await query(executor, 'INSERT INTO notifications (id, tenant_id, recipient_user_id, case_id, title, detail, created_at, `read`, tone) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    [`n-${crypto.randomUUID()}`, tenantId, recipientUserId, caseId, title, detail, isoNow(), tone]);
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage: uploadStorage,
  limits: { files: 5, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(file.mimetype)),
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
    pendingAmount: row.pending_amount / 100, // paise → rupees for display
    overdueDays: row.overdue_days,
    status: row.status,
    assignedAgentId: row.assigned_agent_user_id ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    assignmentNote: row.assignment_note ?? undefined,
    updatedAt: row.updated_at,
    custodyId: row.custody_id ?? undefined,
    failure: row.failure_reason ? { reason: row.failure_reason, note: row.failure_note, recordedAt: row.failure_recorded_at } : undefined,
    paymentCleared: Boolean(row.payment_cleared),
    paymentReference: row.payment_reference ?? undefined,
    paymentConfirmedAt: row.payment_confirmed_at ?? undefined,
    releasePassId: row.release_pass_id ?? undefined,
    authority: row.authority_approved_at ? { documentName: row.authority_document_original_name, approvedAt: row.authority_approved_at } : undefined,
  };
}

function mapCustody(row) {
  return { id: row.id, caseId: row.case_id, vehicleCondition: 'Verified', yardName: row.yard_name, arrivalTime: row.arrival_time, parkingRate: row.parking_rate, createdAt: row.created_at, agentName: row.agent_name, checklist: row.checklist_count, inspection: parseJson(row.inspection_json), customNote: row.custom_note ?? undefined, financeReviewedAt: row.finance_reviewed_at ?? undefined, financeReviewNote: row.finance_review_note ?? undefined };
}

function mapNotification(row) {
  return { id: row.id, caseId: row.case_id ?? undefined, title: row.title, detail: row.detail, createdAt: row.created_at, read: Boolean(row.read), tone: row.tone };
}

function mapEvidence(row) {
  return { id: row.id, caseId: row.case_id, originalName: row.original_name, mimeType: row.mime_type, byteSize: row.byte_size, latitude: row.latitude, longitude: row.longitude, capturedAt: row.captured_at, agentName: row.agent_name ?? undefined };
}

function mapAgent(row, activeCases = 0, completedThisMonth = 0) {
  return { id: row.id, name: row.name, mobile: row.mobile, city: row.city, activeCases, completedThisMonth, status: row.active ? 'Active' : 'Suspended' };
}

function mapReleasePass(row, lifecycle = 'valid') {
  return { id: row.id, caseId: row.case_id, verificationCode: row.verification_code, issuedAt: row.issued_at, borrowerName: row.borrower_name, borrowerMobile: row.borrower_mobile, vehicleRegistration: row.vehicle_registration, vehicleModel: row.vehicle_model, custodyId: row.custody_id ?? undefined, paymentReference: row.payment_reference ?? undefined, issuedByName: row.issued_by_name ?? undefined, signedToken: row.signed_token ?? undefined, lifecycle };
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const user = await queryOne(pool, `SELECT users.*, tenants.name AS tenant_name, auth_sessions.id AS session_id
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      JOIN tenants ON tenants.id = users.tenant_id
      WHERE auth_sessions.token_hash = ? AND auth_sessions.revoked_at IS NULL AND auth_sessions.expires_at > ? AND users.active = 1`, [hashSessionToken(token), isoNow()]);
    if (!user) return res.status(401).json({ error: 'This user account is no longer active.' });
    req.user = apiUser(user);
    req.sessionId = user.session_id;
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired.' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => hasPermission(req.user.permissions, permission) ? next() : res.status(403).json({ error: 'Your role cannot perform this action.' });
}

async function caseForUser(id, user) {
  const row = await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [id, user.tenantId]);
  if (!row || (user.role === 'agent' && row.assigned_agent_user_id !== user.id)) return null;
  return row;
}

async function requireAssignedCase(req, res, next) {
  const recoveryCase = await caseForUser(req.params.id, req.user);
  if (!recoveryCase) return res.status(404).json({ error: 'Assigned recovery case not found.' });
  req.recoveryCase = recoveryCase;
  return next();
}

function requireActiveFieldCase(req, res, next) {
  const error = validateFieldCase(req.recoveryCase);
  return error ? res.status(422).json({ error }) : next();
}

function requireFieldMutation(operation) {
  return async (req, res, next) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    const validationError = validateIdempotencyKey(key);
    if (validationError) return res.status(422).json({ error: validationError });
    try {
      const identity = { tenantId: req.user.tenantId, userId: req.user.id, key, caseId: req.recoveryCase.id, operation };
      const receipt = await readFieldMutation(pool, identity);
      if (receipt) return res.status(receipt.statusCode).json(receipt.body);
      req.fieldMutation = identity;
      return next();
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : 'The field request conflicts with an earlier operation.' });
    }
  };
}

function deleteUploads(files) {
  for (const file of files) if (existsSync(file.path)) unlinkSync(file.path);
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || '');
    const result = await requestSignInOtp({ database: pool, otpProvider, mobile, requestIp: req.ip });
    const user = await queryOne(pool, 'SELECT * FROM users WHERE mobile_e164 = ?', [normalizeIndiaMobile(mobile)]);
    await addAudit(pool, { tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.otp_requested', detail: 'A sign-in OTP was requested.' });
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
      database: pool,
      otpProvider,
      challengeId: String(req.body?.challengeId || ''),
      mobile: String(req.body?.mobile || ''),
      code: String(req.body?.code || ''),
    });
    const user = await queryOne(pool, 'SELECT users.*, tenants.name AS tenant_name FROM users JOIN tenants ON tenants.id = users.tenant_id WHERE users.id = ?', [result.userId]);
    await addAudit(pool, { tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.login', detail: 'Signed in with a verified mobile OTP.' });
    return res.json({ token: result.token, user: apiUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTP verification failed.';
    const status = /unavailable/i.test(message) ? 503 : 401;
    return res.status(status).json({ error: status === 401 ? 'The OTP is invalid, expired, or already used.' : message });
  }
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/logout', auth, async (req, res) => {
  await query(pool, 'UPDATE auth_sessions SET revoked_at = ? WHERE id = ?', [isoNow(), req.sessionId]);
  await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'auth.logout', detail: 'Signed out and revoked the active session.' });
  res.status(204).end();
});

app.get('/api/workspace', auth, async (req, res) => {
  const isAgent = req.user.role === 'agent';
  const caseRows = isAgent
    ? await query(pool, 'SELECT * FROM recovery_cases WHERE tenant_id = ? AND assigned_agent_user_id = ? ORDER BY updated_at DESC', [req.user.tenantId, req.user.id])
    : await query(pool, 'SELECT * FROM recovery_cases WHERE tenant_id = ? ORDER BY updated_at DESC', [req.user.tenantId]);
  const visibleCaseIds = caseRows.map((row) => row.id);
  const custodyRows = isAgent
    ? (visibleCaseIds.length ? await query(pool, 'SELECT * FROM custody_records WHERE tenant_id = ? AND case_id IN (?) ORDER BY created_at DESC', [req.user.tenantId, visibleCaseIds]) : [])
    : await query(pool, 'SELECT * FROM custody_records WHERE tenant_id = ? ORDER BY created_at DESC', [req.user.tenantId]);
  const agentRows = isAgent ? [] : await query(pool, "SELECT id, name, mobile, city, active FROM users WHERE tenant_id = ? AND role = 'agent' ORDER BY name", [req.user.tenantId]);
  // ponytail: month start in ISO; compares against updated_at (close time) as the "completed" proxy — a dedicated closed_at is the exact fix if it ever matters.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();
  const agentData = agentRows.map((agent) => {
    const theirs = caseRows.filter((item) => item.assigned_agent_user_id === agent.id);
    const active = theirs.filter((item) => item.status !== 'closed').length;
    const completed = theirs.filter((item) => item.status === 'closed' && item.updated_at >= monthStartIso).length;
    return mapAgent(agent, active, completed);
  });
  const notificationRows = await listNotifications(pool, req.user);
  const releasePassRows = isAgent ? [] : await query(pool, 'SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.tenant_id = ? ORDER BY release_passes.issued_at DESC', [req.user.tenantId]);
  const eventRows = isAgent ? [] : await query(pool, 'SELECT release_pass_id, event FROM release_pass_events WHERE tenant_id = ?', [req.user.tenantId]);
  const lifecycleByPass = new Map();
  for (const row of eventRows) if (row.event === 'revoked' || !lifecycleByPass.get(row.release_pass_id)) lifecycleByPass.set(row.release_pass_id, row.event); // revoked wins
  res.json({ cases: caseRows.map(mapCase), custody: custodyRows.map(mapCustody), agents: agentData, notifications: notificationRows.map(mapNotification), releasePasses: releasePassRows.map((row) => mapReleasePass(row, lifecycleByPass.get(row.id) || 'valid')) });
});

app.post('/api/agents', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    const agent = await createAgent({ database: pool, tenantId: req.user.tenantId, values: req.body ?? {} });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent.created', detail: `${agent.name} was added as an independent field agent.` });
    return res.status(201).json({ agent: { ...agent, activeCases: 0, completedThisMonth: 0, status: 'Active' } });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The agent could not be added.' });
  }
});

app.put('/api/agents/:id/status', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(422).json({ error: 'Choose an active or suspended status.' });
  try {
    const agent = await setAgentActive({ database: pool, tenantId: req.user.tenantId, agentId: req.params.id, active: req.body.active });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: agent.active ? 'agent.reactivated' : 'agent.suspended', detail: `${agent.name} was ${agent.active ? 'reactivated' : 'suspended'}.` });
    return res.json({ agent: { ...agent, activeCases: 0, completedThisMonth: 0, status: agent.active ? 'Active' : 'Suspended' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent status could not be changed.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.post('/api/accounts', auth, requirePermission(PERMISSIONS.ACCOUNT_MANAGE), async (req, res) => {
  try {
    const account = await createAccount({ database: pool, tenantId: req.user.tenantId, values: req.body ?? {} });
    await addAudit(pool, { tenantId: req.user.tenantId, caseId: account.id, actorUserId: req.user.id, action: 'account.created', detail: `Manual account ${account.accountNumber} was added for finance review.` });
    return res.status(201).json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [account.id, req.user.tenantId])) });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The account could not be added.' });
  }
});

app.put('/api/accounts/:id', auth, requirePermission(PERMISSIONS.ACCOUNT_MANAGE), async (req, res) => {
  try {
    const account = await updateAccount({ database: pool, tenantId: req.user.tenantId, caseId: req.params.id, values: req.body ?? {} });
    await addAudit(pool, { tenantId: req.user.tenantId, caseId: account.id, actorUserId: req.user.id, action: 'account.updated', detail: `Account ${account.accountNumber} details were corrected before authority approval.` });
    return res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [account.id, req.user.tenantId])) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The account could not be updated.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.get('/api/reports/cases.csv', auth, requirePermission(PERMISSIONS.REPORT_EXPORT), async (req, res) => {
  const rows = await query(pool, `SELECT recovery_cases.*, users.name AS agent_name
    FROM recovery_cases LEFT JOIN users ON users.id = recovery_cases.assigned_agent_user_id
    WHERE recovery_cases.tenant_id = ? ORDER BY recovery_cases.updated_at DESC`, [req.user.tenantId]);
  for (const row of rows) row.pending_amount = row.pending_amount / 100; // paise → rupees for the export
  await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'report.exported', detail: `Exported ${rows.length} tenant recovery cases.` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="recovery-cases-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(casesToCsv(rows));
});

app.get('/api/audit-events', auth, requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
  const events = await query(pool, `SELECT audit_events.*, users.name AS actor_name
    FROM audit_events JOIN users ON users.id = audit_events.actor_user_id
    WHERE audit_events.tenant_id = ? ORDER BY audit_events.created_at DESC LIMIT 100`, [req.user.tenantId]);
  res.json({ events: events.map((event) => ({ id: event.id, caseId: event.case_id, actorName: event.actor_name, action: event.action, detail: event.detail, createdAt: event.created_at })) });
});

app.get('/api/members', auth, requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const members = await query(pool, "SELECT id, name, mobile, city, role, active FROM users WHERE tenant_id = ? AND role <> 'agent' ORDER BY role, name", [req.user.tenantId]);
  res.json({ members: members.map((member) => ({ id: member.id, name: member.name, mobile: member.mobile, city: member.city, role: member.role, active: Boolean(member.active) })) });
});

app.post('/api/members', auth, requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  try {
    const member = await createFinanceMember({ database: pool, tenantId: req.user.tenantId, actorRole: req.user.role, values: req.body ?? {} });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'member.created', detail: `${member.name} was added as ${member.role.replace('_', ' ')}.` });
    return res.status(201).json({ member });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The finance user could not be added.' });
  }
});

app.put('/api/members/:id/status', auth, requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(422).json({ error: 'Choose an active or suspended status.' });
  try {
    const member = await setFinanceMemberActive({ database: pool, tenantId: req.user.tenantId, actorUserId: req.user.id, actorRole: req.user.role, memberId: req.params.id, active: req.body.active });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: member.active ? 'member.reactivated' : 'member.suspended', detail: `${member.name} was ${member.active ? 'reactivated' : 'suspended'}.` });
    return res.json({ member });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The finance user status could not be changed.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
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
    const result = await importMonthlyRows({
      database: pool,
      tenantId: req.user.tenantId,
      actorUserId: req.user.id,
      snapshotMonth,
      fileName: req.file.originalname,
      fileSha256: createHash('sha256').update(req.file.buffer).digest('hex'),
      rows: normalized.valid,
      rejectedRows: normalized.errors.length,
    });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'import.completed', detail: `${req.file.originalname}: ${result.accepted} accepted, ${result.rejected} rejected.` });
    await addNotification(pool, { tenantId: req.user.tenantId, title: result.duplicate ? 'Monthly file already imported' : 'Monthly file imported', detail: `${result.accepted} account${result.accepted === 1 ? '' : 's'} processed for ${snapshotMonth.slice(0, 7)}.`, tone: result.rejected ? 'amber' : 'blue' });
    return res.status(result.duplicate ? 200 : 201).json({ result, errors: normalized.errors });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/cases/:id/authority-approval', auth, requirePermission(PERMISSIONS.AUTHORITY_APPROVE), async (req, res, next) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const error = validateCaseAction('approve_authority', caseRow, { hasDocument: true });
  if (error) return res.status(422).json({ error });
  req.recoveryCase = caseRow;
  return next();
}, authorityUpload.single('document'), async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'Attach the signed authority document as a PDF, JPG, or PNG.' });
  const approvedAt = isoNow();
  const fileBytes = readFileSync(req.file.path);
  if (!isAllowedAuthorityDocument(fileBytes, req.file.mimetype)) {
    unlinkSync(req.file.path);
    return res.status(422).json({ error: 'The authority document contents do not match a valid PDF, JPG, or PNG.' });
  }
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');
  await query(pool, "UPDATE recovery_cases SET authority_document_file_name = ?, authority_document_original_name = ?, authority_document_mime_type = ?, authority_document_byte_size = ?, authority_document_sha256 = ?, authority_approved_at = ?, authority_approved_by_user_id = ?, status = 'imported', updated_at = ? WHERE id = ? AND tenant_id = ?",
    [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, sha256, approvedAt, req.user.id, approvedAt, req.recoveryCase.id, req.user.tenantId]);
  await addAudit(pool, { tenantId: req.user.tenantId, caseId: req.recoveryCase.id, actorUserId: req.user.id, action: 'authority.approved', detail: `Authority document ${req.file.originalname} approved for assignment.` });
  await addNotification(pool, { tenantId: req.user.tenantId, caseId: req.recoveryCase.id, title: 'Recovery authority approved', detail: `${req.recoveryCase.id} is ready to assign.`, tone: 'green' });
  return res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [req.recoveryCase.id, req.user.tenantId])) });
});

app.post('/api/cases/:id/authority-revocation', auth, requirePermission(PERMISSIONS.AUTHORITY_APPROVE), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  if (caseRow.status !== 'imported' || !caseRow.authority_approved_at) return res.status(422).json({ error: 'Only an approved, unassigned case can have its authority revoked.' });
  const updatedAt = isoNow();
  await tx(pool, async (conn) => {
    await query(conn, 'UPDATE recovery_cases SET authority_document_file_name = NULL, authority_document_original_name = NULL, authority_document_mime_type = NULL, authority_document_byte_size = NULL, authority_document_sha256 = NULL, authority_approved_at = NULL, authority_approved_by_user_id = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?', [updatedAt, caseRow.id, req.user.tenantId]);
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'authority.revoked', detail: 'Recovery authority revoked to allow account correction.' });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.put('/api/cases/:id/assignment', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  const agentId = String(req.body?.agentId || '');
  const assignmentNote = String(req.body?.assignmentNote || '').trim();
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('assign', caseRow, { assignmentNote });
  if (actionError) return res.status(422).json({ error: actionError });
  const agent = await queryOne(pool, "SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'agent' AND active = 1", [agentId, req.user.tenantId]);
  if (!agent) return res.status(422).json({ error: 'Choose an active agent from this finance company.' });
  const updatedAt = isoNow();
  await tx(pool, async (conn) => {
    await query(conn, "UPDATE recovery_cases SET status = 'assigned', assigned_agent_user_id = ?, assigned_at = ?, assignment_note = ?, updated_at = ?, failure_reason = NULL, failure_note = NULL, failure_recorded_at = NULL WHERE id = ? AND tenant_id = ?",
      [agent.id, updatedAt, assignmentNote || null, updatedAt, caseRow.id, req.user.tenantId]);
    await addNotification(conn, { tenantId: req.user.tenantId, recipientUserId: agent.id, caseId: caseRow.id, title: 'New recovery case assigned', detail: `${caseRow.id} has been assigned to you by the finance team.`, tone: 'blue' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.assigned', detail: `Assigned to ${agent.name}.${assignmentNote ? ` Instruction: ${assignmentNote}` : ''}` });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/cases/:id/attempt', auth, requirePermission(PERMISSIONS.ATTEMPT_SUBMIT), requireAssignedCase, requireFieldMutation('attempt'), requireActiveFieldCase, async (req, res) => {
  const caseRow = req.recoveryCase;
  const reason = String(req.body?.reason || 'Other');
  const note = String(req.body?.note || '').trim();
  const validationError = validateAttempt(caseRow, { reason, note });
  if (validationError) return res.status(422).json({ error: validationError });
  const updatedAt = isoNow();
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const locationDetail = Number.isFinite(latitude) && Number.isFinite(longitude) ? ` GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.` : '';
  const body = await tx(pool, async (conn) => {
    await query(conn, "UPDATE recovery_cases SET status = 'unable_to_recover', failure_reason = ?, failure_note = ?, failure_recorded_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [reason, note, updatedAt, updatedAt, caseRow.id, req.user.tenantId]);
    await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Recovery attempt could not be completed', detail: `${caseRow.id} was marked ${reason.toLowerCase()} by ${req.user.name}.`, tone: 'amber' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'attempt.failed', detail: `${reason}: ${note}${locationDetail}` });
    const response = { case: mapCase(await queryOne(conn, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) };
    await saveFieldMutation(conn, { ...req.fieldMutation, statusCode: 200, body: response, createdAt: updatedAt });
    return response;
  });
  res.json(body);
});

app.post('/api/cases/:id/evidence', auth, requirePermission(PERMISSIONS.CUSTODY_SUBMIT), requireAssignedCase, requireFieldMutation('evidence'), requireActiveFieldCase, upload.array('files', 5), async (req, res, next) => {
  const files = req.files ?? [];
  if (!files.length) return res.status(422).json({ error: 'Capture at least one photo or video before uploading.' });
  if (files.some((file) => !isAllowedEvidenceFile(readFileSync(file.path), file.mimetype))) {
    deleteUploads(files);
    return res.status(422).json({ error: 'Upload valid JPG, PNG, WebP, MP4, or WebM evidence files only.' });
  }
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const capturedAt = String(req.body?.capturedAt || isoNow());
  if (Number.isNaN(Date.parse(capturedAt))) {
    deleteUploads(files);
    return res.status(422).json({ error: 'Evidence capture time is invalid.' });
  }
  try {
    const body = await tx(pool, async (conn) => {
      const records = [];
      for (const file of files) {
        const id = `ev-${crypto.randomUUID()}`;
        await query(conn, 'INSERT INTO evidence (id, tenant_id, case_id, agent_user_id, file_name, original_name, mime_type, byte_size, latitude, longitude, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, req.user.tenantId, req.recoveryCase.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size, Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null, capturedAt]);
        records.push(mapEvidence(await queryOne(conn, 'SELECT * FROM evidence WHERE id = ?', [id])));
      }
      await addAudit(conn, { tenantId: req.user.tenantId, caseId: req.recoveryCase.id, actorUserId: req.user.id, action: 'evidence.uploaded', detail: `${records.length} field evidence file(s) captured.` });
      const response = { evidence: records };
      await saveFieldMutation(conn, { ...req.fieldMutation, statusCode: 201, body: response, createdAt: isoNow() });
      return response;
    });
    return res.status(201).json(body);
  } catch (error) {
    deleteUploads(files);
    return next(error);
  }
});

app.get('/api/cases/:id/evidence', auth, async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const records = await query(pool, 'SELECT evidence.*, users.name AS agent_name FROM evidence JOIN users ON users.id = evidence.agent_user_id WHERE evidence.tenant_id = ? AND evidence.case_id = ? ORDER BY evidence.captured_at DESC', [req.user.tenantId, caseRow.id]);
  res.json({ evidence: records.map(mapEvidence) });
});

app.get('/api/evidence/:id/file', auth, async (req, res) => {
  const evidence = await queryOne(pool, 'SELECT * FROM evidence WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenantId]);
  if (!evidence || !(await caseForUser(evidence.case_id, req.user))) return res.status(404).json({ error: 'Evidence file not found.' });
  res.type(evidence.mime_type).sendFile(join(uploadDirectory, evidence.file_name));
});

app.post('/api/cases/:id/custody', auth, requirePermission(PERMISSIONS.CUSTODY_SUBMIT), requireAssignedCase, requireFieldMutation('custody'), requireActiveFieldCase, async (req, res, next) => {
  const caseRow = req.recoveryCase;
  const yardName = String(req.body?.yardName || '').trim();
  const arrivalTime = String(req.body?.arrivalTime || '').trim();
  const parkingRate = Number(req.body?.parkingRate);
  const checklist = Number(req.body?.checklist || 0);
  const inspection = req.body?.inspection && typeof req.body.inspection === 'object' ? req.body.inspection : null;
  const customNote = String(req.body?.customNote || '').trim();
  const evidenceCount = (await queryOne(pool, 'SELECT COUNT(*) AS count FROM evidence WHERE tenant_id = ? AND case_id = ?', [req.user.tenantId, caseRow.id])).count;
  const validationError = validateCustody(caseRow, { yardName, arrivalTime, parkingRate, checklist, inspection, evidenceCount, customNote });
  if (validationError) return res.status(422).json({ error: validationError });
  const id = `CT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const createdAt = isoNow();
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const locationDetail = Number.isFinite(latitude) && Number.isFinite(longitude) ? ` GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.` : '';
  try {
    const body = await tx(pool, async (conn) => {
      await persistCustody(conn, { id, tenantId: req.user.tenantId, caseId: caseRow.id, yardName, arrivalTime, parkingRate, createdAt, agentName: req.user.name, checklist, inspection, customNote });
      await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Custody report submitted', detail: `${caseRow.id} was submitted by ${req.user.name} and is awaiting finance review.`, tone: 'green' });
      await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.created', detail: `Created ${id} at ${yardName}.${locationDetail}` });
      const response = { case: mapCase(await queryOne(conn, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])), custody: mapCustody(await queryOne(conn, 'SELECT * FROM custody_records WHERE id = ?', [id])) };
      await saveFieldMutation(conn, { ...req.fieldMutation, statusCode: 201, body: response, createdAt });
      return response;
    });
    return res.status(201).json(body);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/cases/:id/custody-review', auth, requirePermission(PERMISSIONS.CUSTODY_REVIEW), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('approve_custody', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const custody = await queryOne(pool, 'SELECT * FROM custody_records WHERE tenant_id = ? AND case_id = ?', [req.user.tenantId, caseRow.id]);
  if (!custody) return res.status(422).json({ error: 'A submitted custody report is required.' });
  const reviewedAt = isoNow();
  const note = String(req.body?.note || '').trim();
  await tx(pool, async (conn) => {
    await query(conn, 'UPDATE custody_records SET finance_reviewed_at = ?, finance_reviewed_by_user_id = ?, finance_review_note = ? WHERE id = ? AND tenant_id = ?', [reviewedAt, req.user.id, note || null, custody.id, req.user.tenantId]);
    await query(conn, "UPDATE recovery_cases SET status = 'payment_pending', updated_at = ? WHERE id = ? AND tenant_id = ?", [reviewedAt, caseRow.id, req.user.tenantId]);
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.approved', detail: note || 'Finance approved the custody report.' });
    await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Custody report approved', detail: `${caseRow.id} can proceed to payment confirmation.`, tone: 'green' });
  });
  return res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [caseRow.id, req.user.tenantId])) });
});

app.post('/api/cases/:id/custody-changes', auth, requirePermission(PERMISSIONS.CUSTODY_REVIEW), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  if (caseRow.status !== 'custody_review') return res.status(422).json({ error: 'Only a submitted custody report can be sent back for changes.' });
  const note = String(req.body?.note || '').trim();
  if (!note) return res.status(422).json({ error: 'Explain what the agent needs to change.' });
  const updatedAt = isoNow();
  await tx(pool, async (conn) => {
    // Custody rows are not immutable; clearing it lets the agent resubmit. Evidence rows stay.
    await query(conn, 'DELETE FROM custody_records WHERE case_id = ? AND tenant_id = ?', [caseRow.id, req.user.tenantId]);
    await query(conn, "UPDATE recovery_cases SET status = 'assigned', custody_id = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?", [updatedAt, caseRow.id, req.user.tenantId]);
    await addNotification(conn, { tenantId: req.user.tenantId, recipientUserId: caseRow.assigned_agent_user_id, caseId: caseRow.id, title: 'Custody report needs changes', detail: `${caseRow.id}: ${note}`, tone: 'amber' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.changes_requested', detail: note });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/cases/:id/payment-confirmation', auth, requirePermission(PERMISSIONS.PAYMENT_CONFIRM), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  const reference = String(req.body?.reference || '').trim();
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('confirm_payment', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  if (!reference) return res.status(422).json({ error: 'Payment reference is required.' });
  const updatedAt = isoNow();
  await tx(pool, async (conn) => {
    await query(conn, "UPDATE recovery_cases SET status = 'payment_confirmed', payment_cleared = 1, payment_reference = ?, payment_confirmed_at = ?, payment_confirmed_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [reference, updatedAt, req.user.id, updatedAt, caseRow.id, req.user.tenantId]);
    await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Payment confirmed', detail: `${caseRow.id} is ready for a printable customer release pass.`, tone: 'green' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'payment.confirmed', detail: `Manual finance reference: ${reference}` });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/cases/:id/release-pass', auth, requirePermission(PERMISSIONS.RELEASE_ISSUE), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('issue_release', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const existingPass = await queryOne(pool, 'SELECT * FROM release_passes WHERE tenant_id = ? AND case_id = ?', [req.user.tenantId, caseRow.id]);
  if (existingPass) return res.json({ case: mapCase(caseRow), releasePass: mapReleasePass(existingPass) });
  const passId = `RP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const verificationCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const updatedAt = isoNow();
  const exp = new Date(Date.now() + RELEASE_TTL_MS).toISOString();
  const signedToken = releaseSigner.configured ? releaseSigner.sign({ passId, orgId: req.user.tenantId, issuedAt: updatedAt, exp, reg: String(caseRow.registration).slice(-4) }) : null;
  await tx(pool, async (conn) => {
    await persistReleasePass(conn, { id: passId, tenantId: req.user.tenantId, caseId: caseRow.id, issuedByUserId: req.user.id, verificationCode, issuedAt: updatedAt, borrowerName: caseRow.borrower_name, borrowerMobile: caseRow.borrower_mobile, vehicleRegistration: caseRow.registration, vehicleModel: caseRow.make_model, custodyId: caseRow.custody_id, paymentReference: caseRow.payment_reference, signedToken, keyId: releaseSigner.keyId });
    await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Release pass issued', detail: `${passId} is ready to print for ${caseRow.borrower_name}.`, tone: 'green' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'release_pass.issued', detail: `Issued ${passId}.` });
  });
  const updatedCase = await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id]);
  const releasePass = await queryOne(pool, 'SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.id = ?', [passId]);
  res.json({ case: mapCase(updatedCase), releasePass: mapReleasePass(releasePass) });
});

app.post('/api/cases/:id/release-revocation', auth, requirePermission(PERMISSIONS.RELEASE_REVOKE), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const pass = await queryOne(pool, 'SELECT * FROM release_passes WHERE tenant_id = ? AND case_id = ?', [req.user.tenantId, caseRow.id]);
  if (!pass) return res.status(422).json({ error: 'There is no release pass to revoke.' });
  const reason = String(req.body?.reason || '').trim();
  try {
    await tx(pool, async (conn) => {
      await query(conn, "INSERT INTO release_pass_events (tenant_id, release_pass_id, case_id, event, actor_user_id, reason, created_at) VALUES (?, ?, ?, 'revoked', ?, ?, ?)", [req.user.tenantId, pass.id, caseRow.id, req.user.id, reason || null, isoNow()]);
      await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'release_pass.revoked', detail: reason || `Revoked ${pass.id}.` });
    });
  } catch {
    return res.status(409).json({ error: 'This release pass is already revoked.' });
  }
  res.json({ ok: true });
});

app.post('/api/cases/:id/close', auth, requirePermission(PERMISSIONS.RELEASE_CLOSE), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('close', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  await tx(pool, async (conn) => {
    await query(conn, "UPDATE recovery_cases SET status = 'closed', updated_at = ? WHERE id = ? AND tenant_id = ?", [isoNow(), caseRow.id, req.user.tenantId]);
    if (caseRow.release_pass_id) await query(conn, "INSERT IGNORE INTO release_pass_events (tenant_id, release_pass_id, case_id, event, actor_user_id, reason, created_at) VALUES (?, ?, ?, 'redeemed', ?, NULL, ?)", [req.user.tenantId, caseRow.release_pass_id, caseRow.id, req.user.id, isoNow()]);
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.closed', detail: 'Finance user recorded final release and closure.' });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  await markNotificationsRead(pool, req.user, isoNow());
  res.status(204).end();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function verifyPageHtml({ state, financer, passId, reg }) {
  const map = {
    valid: ['#168260', '#e5f6ef', 'Valid release pass', 'This pass is active. Check the vehicle details below before releasing.'],
    revoked: ['#be4e4b', '#fff0ee', 'Revoked — do not release', 'The finance company has revoked this release pass.'],
    redeemed: ['#a35f0c', '#fff3df', 'Already redeemed', 'This vehicle has already been released against this pass.'],
    expired: ['#a35f0c', '#fff3df', 'Expired pass', 'This pass is past its validity. Contact the finance company.'],
    invalid: ['#be4e4b', '#fff0ee', 'Invalid pass', 'This code is not a recognized release pass.'],
  };
  const [color, soft, title, message] = map[state] || map.invalid;
  const details = passId ? `<dl><div><dt>Finance company</dt><dd>${escapeHtml(financer)}</dd></div><div><dt>Pass ID</dt><dd>${escapeHtml(passId)}</dd></div><div><dt>Vehicle</dt><dd>${escapeHtml(reg)}</dd></div></dl>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Release pass verification</title><style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;color:#17283d;display:grid;place-items:center;min-height:100vh;padding:20px}.card{width:100%;max-width:420px;background:#fff;border:1px solid #e6ebf1;border-radius:14px;box-shadow:0 18px 45px rgba(18,45,78,.10);overflow:hidden}.top{background:${soft};color:${color};padding:22px;font-weight:800;font-size:18px}.body{padding:20px}p{color:#54657c;font-size:13px;line-height:1.5;margin:0 0 14px}dl{margin:0;display:grid;gap:10px}dl div{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #eef2f6;padding-top:10px}dt{color:#8a97a7;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:800}dd{margin:0;font-weight:700;font-size:13px;text-align:right}.brand{padding:14px 20px;border-top:1px solid #eef2f6;color:#8a97a7;font-size:11px;font-weight:700}</style></head><body><div class="card"><div class="top">${title}</div><div class="body"><p>${message}</p>${details}</div><div class="brand">Handoff · recovery operations</div></div></body></html>`;
}

app.get('/r/:token', async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // ponytail: no rate-limit here yet — pilot is LAN-only; add it in the hardening phase (Phase 7).
  const result = releaseSigner.verify(req.params.token);
  let state = 'invalid';
  let financer = '';
  let passId = '';
  let reg = '';
  if (result.valid) {
    const pass = await queryOne(pool, 'SELECT release_passes.*, tenants.name AS tenant_name FROM release_passes JOIN tenants ON tenants.id = release_passes.tenant_id WHERE release_passes.id = ?', [result.claims.passId]);
    if (pass) {
      const events = await query(pool, 'SELECT event FROM release_pass_events WHERE release_pass_id = ?', [pass.id]);
      const set = new Set(events.map((row) => row.event));
      state = set.has('revoked') ? 'revoked' : set.has('redeemed') ? 'redeemed' : 'valid';
      financer = pass.tenant_name;
      passId = pass.id;
      reg = maskRegistration(pass.vehicle_registration);
    }
  } else if (result.reason === 'expired') {
    state = 'expired';
  }
  res.type('html').send(verifyPageHtml({ state, financer, passId, reg }));
});

const distDirectory = join(appDirectory, '..', 'dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(join(distDirectory, 'index.html')));
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(422).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file is larger than the allowed limit.' : 'The upload could not be accepted.' });
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

await migrate(pool);
if (config.nodeEnv !== 'production') await seedDevData(pool);
app.listen(port, config.listenHost, () => console.log(`Handoff API listening on http://${config.listenHost}:${port}`));
