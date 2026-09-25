import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, query, queryOne, tx } from './mysql.mjs';
import { seedDevData } from './seed-dev.mjs';
import { loadConfig } from './config.mjs';
import { redactForAgent, validateCaseAction } from './case-actions.mjs';
import { isAllowedAuthorityDocument, isAllowedEvidenceFile } from './file-validation.mjs';
import { createDevelopmentOtpService, createOtpService, normalizeIndiaMobile } from './otp-service.mjs';
import { requestSignInOtp, verifySignInOtp, requestSignUpOtp, verifySignUpOtp } from './otp-auth.mjs';
import { hashSessionToken } from './session-token.mjs';
import { PERMISSIONS, PLATFORM_MANAGE, hasPermission, permissionsForRole } from '../shared/contracts.mjs';
import { billingSummary, decideTopup, mapTopup, platformSettings, requestTopup } from './billing.mjs';
import { normalizeImportRows, parseImportFile } from './import-parser.mjs';
import { importMonthlyRows } from './monthly-import.mjs';
import { agentRates, createAgent, listAgentCases, notSuspendedBy, setAgentActive, searchAgentDirectory, linkAgent } from './agent-management.mjs';
import { rateAgent, ratingSummaries } from './agent-ratings.mjs';
import { VERIFICATION_PHOTOS, assignVerification, cancelVerification, createVerification, listVerifications, mapVerification, validateVerificationSubmission } from './verification.mjs';
import { listGroups, createGroup, updateGroup, deleteGroup, broadcastToGroup } from './agent-groups.mjs';
import { createAccount, normalizeAccountRows, updateAccount } from './account-management.mjs';
import { apiKeyAllowance, createApiKey, decideApiKeyRequest, findActiveApiKey, listApiKeys, mapKeyRequest, requestExtraApiKey, revokeApiKey } from './api-keys.mjs';
import { casesToCsv } from './report-export.mjs';
import { createFinanceMember, setFinanceMemberActive } from './member-management.mjs';
import { readLocation, validateAttempt, validateCustody, validateFieldCase } from './field-validation.mjs';
import { persistCustody, persistReleasePass } from './workflow-persistence.mjs';
import { readFieldMutation, saveFieldMutation, validateIdempotencyKey } from './field-mutations.mjs';
import { listNotifications, markNotificationsRead } from './notification-access.mjs';
import { createReleaseSigner } from './release-signing.mjs';
import { clientKey, rateLimit } from './rate-limit.mjs';

const app = express();
// Behind Cloudflare (tunnel or proxied DNS): trust the proxy so req.ip is the real client
// IP (from X-Forwarded-For) instead of the local hop, which per-IP rate limiting relies on.
app.set('trust proxy', true);
const config = loadConfig();
const port = config.port;
const pool = createPool(config.databaseUrl);
const otpProvider = config.nodeEnv === 'production'
  ? createOtpService({ authKey: config.msg91AuthKey, templateId: config.msg91OtpTemplateId })
  : createDevelopmentOtpService(config.developmentOtpCode);
const releaseSigner = createReleaseSigner({ privateKey: config.releaseSigningPrivateKey, publicKey: config.releaseSigningPublicKey, keyId: config.releaseSigningKeyId });
const RELEASE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // ponytail: 90-day pass validity; make it configurable if a real retention policy appears
const maskRegistration = (reg) => String(reg || '').replace(/.(?=.{4})/g, '•');
// Normalize a stored mobile (raw 10-digit, 91-prefixed, or already spaced) to a consistent display.
function formatMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : null;
  return local ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : String(value || '');
}
const appDirectory = dirname(fileURLToPath(import.meta.url));
const uploadDirectory = join(appDirectory, 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

// Per-IP limits for the unauthenticated surface. Generous enough never to bite a real
// person; low enough to blunt SMS bombing, OTP brute force, and pass-verify scraping.
// Production only: in dev/test many people can share one IP (e.g. behind a Cloudflare
// tunnel), where per-IP limiting would falsely throttle the whole group.
// For a real proxied deployment also set `app.set('trust proxy', 1)` so req.ip is the client's.
const passThroughLimiter = (_req, _res, next) => next();
const otpLimiter = config.nodeEnv === 'production' ? rateLimit({ windowMs: 5 * 60 * 1000, max: 25 }) : passThroughLimiter;
const verifyPageLimiter = config.nodeEnv === 'production' ? rateLimit({ windowMs: 60 * 1000, max: 60 }) : passThroughLimiter;

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
  return { id: row.id, tenantId: row.tenant_id, role: row.role, permissions: permissionsForRole(row.role), name: row.name, email: row.email, mobile: row.mobile, city: row.city, tenantName: row.tenant_name ?? null, onboardingComplete: Boolean(row.onboarding_complete), ...(row.role === 'agent' ? { rates: agentRates(row) } : {}) };
}

function mapCase(row, assignedAgents = []) {
  return {
    assignedAgents,
    id: row.id,
    accountNumber: row.account_number,
    borrower: { name: row.borrower_name, mobile: formatMobile(row.borrower_mobile), address: row.borrower_address },
    vehicle: { registration: row.registration, makeModel: row.make_model, chassis: row.chassis, type: row.vehicle_type },
    branch: row.branch,
    pendingAmount: row.pending_amount / 100, // paise → rupees for display
    overdueDays: row.overdue_days,
    status: row.status,
    assignedAgentId: row.assigned_agent_user_id ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    assignmentNote: row.assignment_note ?? undefined,
    updatedAt: row.updated_at,
    createdAt: row.created_at ?? row.updated_at,
    billingLocked: Boolean(row.billing_locked),
    openOfferAt: row.open_offer_at ?? undefined,
    agentVisibility: { customer: row.share_customer !== 0, vehicle: row.share_vehicle !== 0 },
    finance: row.finance_company ? { company: row.finance_company, contactName: row.finance_contact_name ?? undefined, contactMobile: row.finance_contact_mobile ? formatMobile(row.finance_contact_mobile) : undefined } : undefined,
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
  return { id: row.id, caseId: row.case_id, vehicleCondition: 'Verified', yardName: row.yard_name, arrivalTime: row.arrival_time, parkingRate: row.parking_rate, createdAt: row.created_at, agentName: row.agent_name, checklist: row.checklist_count, inspection: parseJson(row.inspection_json), customNote: row.custom_note ?? undefined, financeReviewedAt: row.finance_reviewed_at ?? undefined, financeReviewNote: row.finance_review_note ?? undefined, latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined };
}

function mapNotification(row) {
  return { id: row.id, caseId: row.case_id ?? undefined, title: row.title, detail: row.detail, createdAt: row.created_at, read: Boolean(row.read), tone: row.tone };
}

function mapEvidence(row) {
  return { id: row.id, caseId: row.case_id, originalName: row.original_name, mimeType: row.mime_type, byteSize: row.byte_size, latitude: row.latitude, longitude: row.longitude, capturedAt: row.captured_at, agentName: row.agent_name ?? undefined };
}

function mapAgent(row, activeCases = 0, completedThisMonth = 0, rating = null) {
  return { id: row.id, name: row.name, mobile: row.mobile, city: row.city, activeCases, completedThisMonth, status: row.active ? 'Active' : 'Suspended', rating, rates: agentRates(row) };
}

function mapReleasePass(row, lifecycle = 'valid') {
  return { id: row.id, caseId: row.case_id, verificationCode: row.verification_code, issuedAt: row.issued_at, borrowerName: row.borrower_name, borrowerMobile: formatMobile(row.borrower_mobile), vehicleRegistration: row.vehicle_registration, vehicleModel: row.vehicle_model, custodyId: row.custody_id ?? undefined, paymentReference: row.payment_reference ?? undefined, issuedByName: row.issued_by_name ?? undefined, signedToken: row.signed_token ?? undefined, lifecycle };
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const user = await queryOne(pool, `SELECT users.*, tenants.name AS tenant_name, auth_sessions.id AS session_id
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      LEFT JOIN tenants ON tenants.id = users.tenant_id
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
  const row = await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [id]);
  if (!row) return null;
  if (user.role === 'agent') {
    // An agent reaches a case through an active co-assignment, in whichever tenant owns it.
    const assigned = await queryOne(pool, `SELECT 1 AS x FROM case_assignments WHERE case_id = ? AND agent_user_id = ? AND active = 1 AND ${notSuspendedBy('?')}`, [id, user.id, user.id, row.tenant_id]);
    return assigned ? row : null;
  }
  return row.tenant_id === user.tenantId ? row : null;
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
      const job = req.recoveryCase ?? req.verification;
      const identity = { tenantId: job.tenant_id, userId: req.user.id, key, caseId: job.id, operation };
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

app.post('/api/auth/request-otp', otpLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || '');
    const result = await requestSignInOtp({ database: pool, otpProvider, mobile, requestIp: req.ip });
    const user = await queryOne(pool, 'SELECT * FROM users WHERE mobile_e164 = ?', [normalizeIndiaMobile(mobile)]);
    // Self-registered agents have no tenant yet; audit rows require one. Mirror the verify-otp guard below.
    if (user.tenant_id) await addAudit(pool, { tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.otp_requested', detail: 'A sign-in OTP was requested.' });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTP could not be sent.';
    const status = /too many/i.test(message) ? 429 : /unavailable|rejected/i.test(message) ? 503 : 422;
    return res.status(status).json({ error: message });
  }
});

app.post('/api/auth/verify-otp', otpLimiter, async (req, res) => {
  try {
    const result = await verifySignInOtp({
      database: pool,
      otpProvider,
      challengeId: String(req.body?.challengeId || ''),
      mobile: String(req.body?.mobile || ''),
      code: String(req.body?.code || ''),
    });
    const user = await queryOne(pool, 'SELECT users.*, tenants.name AS tenant_name FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id WHERE users.id = ?', [result.userId]);
    if (user.tenant_id) await addAudit(pool, { tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.login', detail: 'Signed in with a verified mobile OTP.' });
    return res.json({ token: result.token, user: apiUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OTP verification failed.';
    const status = /unavailable/i.test(message) ? 503 : 401;
    return res.status(status).json({ error: status === 401 ? 'The OTP is invalid, expired, or already used.' : message });
  }
});

app.post('/api/agent/signup/request-otp', otpLimiter, async (req, res) => {
  try {
    const result = await requestSignUpOtp({ database: pool, otpProvider, mobile: String(req.body?.mobile || ''), requestIp: req.ip });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-up OTP could not be sent.';
    const status = /already has an account/i.test(message) ? 409 : /too many/i.test(message) ? 429 : /unavailable|rejected/i.test(message) ? 503 : 422;
    return res.status(status).json({ error: message });
  }
});

app.post('/api/agent/signup/verify', otpLimiter, async (req, res) => {
  try {
    const result = await verifySignUpOtp({ database: pool, otpProvider, challengeId: String(req.body?.challengeId || ''), mobile: String(req.body?.mobile || ''), code: String(req.body?.code || '') });
    const user = await queryOne(pool, 'SELECT users.*, tenants.name AS tenant_name FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id WHERE users.id = ?', [result.userId]);
    return res.json({ token: result.token, user: apiUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-up verification failed.';
    return res.status(/unavailable/i.test(message) ? 503 : 401).json({ error: message });
  }
});

app.put('/api/profile', auth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const city = String(req.body?.city || '').trim();
  if (name.length < 2 || name.length > 100) return res.status(422).json({ error: 'Enter your full name.' });
  if (city.length < 2 || city.length > 100) return res.status(422).json({ error: 'Enter your city.' });
  const idProof = String(req.body?.idProof || '').trim();
  // ID proof is required to finish onboarding; a later settings edit may omit it (the existing value is kept).
  if (req.user.role === 'agent' && req.user.onboardingComplete === false && idProof.length < 4) return res.status(422).json({ error: 'Add a valid ID proof reference.' });
  const rates = req.user.role === 'agent' ? [parseRate(req.body?.rateVehicle), parseRate(req.body?.rateVerification)] : [undefined, undefined];
  if (rates.some(Number.isNaN)) return res.status(422).json({ error: 'Rates must be between ₹0 and ₹1,00,000.' });
  await query(pool, "UPDATE users SET name = ?, city = ?, id_proof = COALESCE(NULLIF(?, ''), id_proof), onboarding_complete = CASE WHEN role = 'agent' THEN 1 ELSE onboarding_complete END, rate_vehicle_paise = CASE WHEN ? THEN ? ELSE rate_vehicle_paise END, rate_verification_paise = CASE WHEN ? THEN ? ELSE rate_verification_paise END WHERE id = ?",
    [name, city, idProof, rates[0] !== undefined, rates[0] ?? null, rates[1] !== undefined, rates[1] ?? null, req.user.id]);
  const user = await queryOne(pool, 'SELECT users.*, tenants.name AS tenant_name FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id WHERE users.id = ?', [req.user.id]);
  return res.json({ user: apiUser(user) });
});

// Rupees -> paise. undefined = leave unchanged, blank = clear, NaN = invalid.
function parseRate(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const paise = Math.round(Number(value) * 100);
  return Number.isInteger(paise) && paise >= 0 && paise <= 10_000_000 ? paise : NaN;
}

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/logout', auth, async (req, res) => {
  await query(pool, 'UPDATE auth_sessions SET revoked_at = ? WHERE id = ?', [isoNow(), req.sessionId]);
  if (req.user.tenantId) await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'auth.logout', detail: 'Signed out and revoked the active session.' });
  res.status(204).end();
});

app.get('/api/workspace', auth, async (req, res) => {
  const isAgent = req.user.role === 'agent';
  const caseRows = isAgent
    ? await listAgentCases(pool, req.user.id)
    : await query(pool, 'SELECT * FROM recovery_cases WHERE tenant_id = ? ORDER BY updated_at DESC', [req.user.tenantId]);
  const visibleCaseIds = caseRows.map((row) => row.id);
  const custodyRows = isAgent
    ? (visibleCaseIds.length ? await query(pool, 'SELECT * FROM custody_records WHERE case_id IN (?) ORDER BY created_at DESC', [visibleCaseIds]) : [])
    : await query(pool, 'SELECT * FROM custody_records WHERE tenant_id = ? ORDER BY created_at DESC', [req.user.tenantId]);
  const agentRows = isAgent ? [] : await query(pool, "SELECT users.id, users.name, users.mobile, users.city, users.rate_vehicle_paise, users.rate_verification_paise, m.active FROM agent_memberships m JOIN users ON users.id = m.agent_user_id WHERE m.tenant_id = ? ORDER BY users.name", [req.user.tenantId]);
  // Active count per agent from live co-assignments.
  const assignmentCounts = isAgent ? [] : await query(pool, "SELECT ca.agent_user_id AS id, COUNT(*) AS n FROM case_assignments ca JOIN recovery_cases rc ON rc.id = ca.case_id WHERE ca.tenant_id = ? AND ca.active = 1 AND rc.status <> 'closed' GROUP BY ca.agent_user_id", [req.user.tenantId]);
  const activeByAgent = new Map(assignmentCounts.map((row) => [row.id, row.n]));
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  // Per-entry platform: count field outcomes the agent submitted this month, not closures.
  const submittedCounts = isAgent ? [] : await query(pool, "SELECT actor_user_id AS id, COUNT(*) AS n FROM audit_events WHERE tenant_id = ? AND action IN ('attempt.failed', 'custody.created', 'verification.submitted') AND created_at >= ? GROUP BY actor_user_id", [req.user.tenantId, monthStart.toISOString()]);
  const submittedByAgent = new Map(submittedCounts.map((row) => [row.id, row.n]));
  const ratings = await ratingSummaries(pool, agentRows.map((agent) => agent.id));
  const agentData = agentRows.map((agent) => mapAgent(agent, activeByAgent.get(agent.id) ?? 0, submittedByAgent.get(agent.id) ?? 0, ratings.get(agent.id) ?? null));
  const notificationRows = await listNotifications(pool, req.user);
  const releasePassRows = isAgent ? [] : await query(pool, 'SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.tenant_id = ? ORDER BY release_passes.issued_at DESC', [req.user.tenantId]);
  const eventRows = isAgent ? [] : await query(pool, 'SELECT release_pass_id, event FROM release_pass_events WHERE tenant_id = ?', [req.user.tenantId]);
  const lifecycleByPass = new Map();
  for (const row of eventRows) if (row.event === 'revoked' || !lifecycleByPass.get(row.release_pass_id)) lifecycleByPass.set(row.release_pass_id, row.event); // revoked wins
  const assignmentRows = isAgent ? [] : await query(pool, "SELECT ca.case_id, ca.agent_user_id, users.name, r.stars FROM case_assignments ca JOIN users ON users.id = ca.agent_user_id LEFT JOIN agent_ratings r ON r.tenant_id = ca.tenant_id AND r.job_type = 'case' AND r.job_id = ca.case_id AND r.agent_user_id = ca.agent_user_id WHERE ca.tenant_id = ? AND ca.active = 1", [req.user.tenantId]);
  const agentsByCase = new Map();
  for (const row of assignmentRows) { const list = agentsByCase.get(row.case_id) || []; list.push({ id: row.agent_user_id, name: row.name, stars: row.stars ?? undefined }); agentsByCase.set(row.case_id, list); }
  const groups = isAgent ? [] : await listGroups({ database: pool, tenantId: req.user.tenantId });
  res.json({ cases: caseRows.map((row) => { const item = mapCase(row, agentsByCase.get(row.id) || []); return isAgent ? redactForAgent(item) : item; }), custody: custodyRows.map(mapCustody), agents: agentData, groups, verifications: (await listVerifications(pool, req.user)).map((row) => mapVerification(row, formatMobile)), openOffers: isAgent ? (await listOpenOffers(req.user.id)).map(mapOffer) : [], notifications: notificationRows.map(mapNotification), releasePasses: releasePassRows.map((row) => mapReleasePass(row, lifecycleByPass.get(row.id) || 'valid')) });
});

app.post('/api/agents', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    const agent = await createAgent({ database: pool, tenantId: req.user.tenantId, values: req.body ?? {}, addedByUserId: req.user.id });
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

app.get('/api/agents/directory', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  const agents = await searchAgentDirectory({ database: pool, tenantId: req.user.tenantId, q: String(req.query?.q || '') });
  const ratings = await ratingSummaries(pool, agents.map((agent) => agent.id));
  res.json({ agents: agents.map((agent) => ({ ...agent, rating: ratings.get(agent.id) ?? null })) });
});

app.post('/api/agents/:id/link', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    const agent = await linkAgent({ database: pool, tenantId: req.user.tenantId, agentId: req.params.id, addedByUserId: req.user.id });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent.linked', detail: `${agent.name} was added to the roster from the directory.` });
    return res.status(201).json({ agent: { ...agent, activeCases: 0, completedThisMonth: 0, status: 'Active' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add the agent.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.get('/api/agent-groups', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  res.json({ groups: await listGroups({ database: pool, tenantId: req.user.tenantId }) });
});

app.post('/api/agent-groups', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    const group = await createGroup({ database: pool, tenantId: req.user.tenantId, name: req.body?.name, agentIds: req.body?.agentIds });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent_group.created', detail: `Agent group “${group.name}” was created.` });
    return res.status(201).json({ group });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The group could not be created.' });
  }
});

app.put('/api/agent-groups/:id', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    await updateGroup({ database: pool, tenantId: req.user.tenantId, groupId: req.params.id, name: req.body?.name, agentIds: req.body?.agentIds });
    return res.json({ groups: await listGroups({ database: pool, tenantId: req.user.tenantId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The group could not be updated.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.delete('/api/agent-groups/:id', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    await deleteGroup({ database: pool, tenantId: req.user.tenantId, groupId: req.params.id });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent_group.deleted', detail: 'An agent group was deleted.' });
    return res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The group could not be deleted.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.post('/api/agent-groups/:id/broadcast', auth, requirePermission(PERMISSIONS.AGENT_MANAGE), async (req, res) => {
  try {
    const result = await broadcastToGroup({ database: pool, tenantId: req.user.tenantId, groupId: req.params.id, title: req.body?.title, detail: req.body?.detail });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'agent_group.broadcast', detail: `Sent “${String(req.body?.title || '').trim()}” to ${result.delivered} agent(s).` });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message could not be sent.';
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
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'import.completed', detail: `${req.file.originalname}: ${result.accepted} accepted, ${result.rejected} rejected.${result.billing ? ` Billed ${result.billing.paid}, locked ${result.billing.pending} awaiting recharge.` : ''}` });
    await addNotification(pool, { tenantId: req.user.tenantId, title: result.duplicate ? 'Monthly file already imported' : 'Monthly file imported', detail: `${result.accepted} account${result.accepted === 1 ? '' : 's'} processed for ${snapshotMonth.slice(0, 7)}.`, tone: result.rejected ? 'amber' : 'blue' });
    return res.status(result.duplicate ? 200 : 201).json({ result, errors: normalized.errors });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/billing', auth, requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res) => {
  res.json(await billingSummary(pool, req.user.tenantId));
});

app.post('/api/billing/topups', auth, requirePermission(PERMISSIONS.BILLING_MANAGE), async (req, res) => {
  try {
    const topup = await requestTopup({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, amountPaise: req.body?.amountPaise, reference: req.body?.reference });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'billing.topup_requested', detail: `Requested a ₹${topup.amountPaise / 100} wallet recharge (reference ${topup.reference}).` });
    return res.status(201).json({ topup });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The recharge request could not be saved.' });
  }
});

const requirePlatform = requirePermission(PLATFORM_MANAGE);

app.get('/api/platform/overview', auth, requirePlatform, async (_req, res) => {
  const topups = await query(pool, `SELECT t.*, tenants.name AS tenant_name, users.name AS requested_by_name FROM topup_requests t
    JOIN tenants ON tenants.id = t.tenant_id JOIN users ON users.id = t.requested_by_user_id
    ORDER BY t.status = 'pending' DESC, t.created_at DESC LIMIT 200`);
  const tenants = await query(pool, `SELECT tenants.id, tenants.name, COALESCE(w.balance_paise, 0) AS balance_paise,
      COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.amount_paise END), 0) AS due_paise,
      COALESCE(SUM(c.status = 'pending'), 0) AS locked_count, COUNT(c.id) AS charged_count
    FROM tenants LEFT JOIN wallets w ON w.tenant_id = tenants.id LEFT JOIN billing_charges c ON c.tenant_id = tenants.id
    WHERE tenants.archived_at IS NULL
    GROUP BY tenants.id, tenants.name, w.balance_paise ORDER BY tenants.name`);
  const keyRequests = await query(pool, `SELECT r.*, tenants.name AS tenant_name, users.name AS requested_by_name FROM api_key_requests r
    JOIN tenants ON tenants.id = r.tenant_id JOIN users ON users.id = r.requested_by_user_id
    ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 100`);
  const settings = await platformSettings(pool);
  res.json({
    keyRequests: keyRequests.map(mapKeyRequest),
    topups: topups.map(mapTopup),
    tenants: tenants.map((row) => ({ id: row.id, name: row.name, balancePaise: Number(row.balance_paise), duePaise: Number(row.due_paise), lockedCount: Number(row.locked_count), chargedCount: Number(row.charged_count) })),
    settings: { vehicleRowPaise: Number(settings.vehicle_row_paise), verificationFeePaise: Number(settings.verification_fee_paise), apiKeyFeePaise: Number(settings.api_key_fee_paise), paymentInstructions: settings.payment_instructions ?? '' },
  });
});

app.post('/api/platform/topups/:id/decision', auth, requirePlatform, async (req, res) => {
  const approve = req.body?.decision === 'confirm';
  if (!approve && req.body?.decision !== 'reject') return res.status(422).json({ error: 'Choose confirm or reject.' });
  try {
    const result = await decideTopup({ database: pool, topupId: req.params.id, adminUserId: req.user.id, approve });
    await addAudit(pool, { tenantId: result.tenantId, actorUserId: req.user.id, action: approve ? 'billing.topup_confirmed' : 'billing.topup_rejected', detail: approve ? `Wallet recharge confirmed; ${result.settled} pending charge(s) settled.` : 'Wallet recharge request rejected.' });
    await addNotification(pool, { tenantId: result.tenantId, title: approve ? 'Wallet recharged' : 'Recharge request rejected', detail: approve ? `Your recharge was confirmed. ${result.settled} locked record(s) were unlocked.` : 'Your recharge could not be verified. Contact support with your payment reference.', tone: approve ? 'green' : 'red' });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The top-up could not be decided.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.put('/api/platform/settings', auth, requirePlatform, async (req, res) => {
  const vehicleRowPaise = Math.round(Number(req.body?.vehicleRowRupees) * 100);
  const verificationFeePaise = Math.round(Number(req.body?.verificationFeeRupees) * 100);
  const apiKeyFeePaise = Math.round(Number(req.body?.apiKeyFeeRupees) * 100);
  const paymentInstructions = String(req.body?.paymentInstructions ?? '').trim();
  const validPrice = (value) => Number.isInteger(value) && value >= 0 && value <= 10_000_000;
  if (!validPrice(vehicleRowPaise) || !validPrice(verificationFeePaise) || !validPrice(apiKeyFeePaise)) return res.status(422).json({ error: 'Prices must be between ₹0 and ₹1,00,000.' });
  if (paymentInstructions.length > 2000) return res.status(422).json({ error: 'Keep payment instructions within 2,000 characters.' });
  await query(pool, 'UPDATE platform_settings SET vehicle_row_paise = ?, verification_fee_paise = ?, api_key_fee_paise = ?, payment_instructions = ?, updated_at = ? WHERE id = 1', [vehicleRowPaise, verificationFeePaise, apiKeyFeePaise, paymentInstructions || null, isoNow()]);
  res.json({ settings: { vehicleRowPaise, verificationFeePaise, apiKeyFeePaise, paymentInstructions } });
});

app.post('/api/platform/api-key-requests/:id/decision', auth, requirePlatform, async (req, res) => {
  const approve = req.body?.decision === 'approve';
  if (!approve && req.body?.decision !== 'reject') return res.status(422).json({ error: 'Choose approve or reject.' });
  try {
    const result = await decideApiKeyRequest({ database: pool, requestId: req.params.id, adminUserId: req.user.id, approve });
    await addAudit(pool, { tenantId: result.tenantId, actorUserId: req.user.id, action: approve ? 'api_key.request_approved' : 'api_key.request_rejected', detail: approve ? `Additional API key approved; ₹${result.feePaise / 100} charged.` : 'Additional API key request rejected.' });
    await addNotification(pool, { tenantId: result.tenantId, title: approve ? 'Additional API key approved' : 'API key request rejected', detail: approve ? `You can now create one more API key in Settings. ₹${result.feePaise / 100} was charged to your wallet.` : 'Your request for an additional API key was not approved. Contact Handoff support for details.', tone: approve ? 'green' : 'amber' });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request could not be decided.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

// ---- Open offers: send an unassigned case to every active roster agent; the first to accept is assigned ----
const OFFERABLE_STATUSES = ['imported', 'unable_to_recover'];
const offerError = (status, message) => Object.assign(new Error(message), { status });

async function listOpenOffers(agentId) {
  return query(pool, `SELECT rc.id, rc.vehicle_type, rc.make_model, rc.registration, rc.branch, rc.share_vehicle, rc.open_offer_at, t.name AS finance_company
      FROM recovery_cases rc
      JOIN agent_memberships m ON m.tenant_id = rc.tenant_id AND m.agent_user_id = ? AND m.active = 1
      JOIN tenants t ON t.id = rc.tenant_id
     WHERE rc.open_offer_at IS NOT NULL AND rc.billing_locked = 0 AND rc.status IN (?)
       AND NOT EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = rc.id AND ca.active = 1)
     ORDER BY rc.open_offer_at DESC`, [agentId, OFFERABLE_STATUSES]);
}

// Before accepting, an agent sees only enough to decide: never the borrower's details.
function mapOffer(row) {
  return { id: row.id, financeCompany: row.finance_company, branch: row.branch, offeredAt: row.open_offer_at, vehicle: { type: row.vehicle_type, registration: row.registration, makeModel: row.share_vehicle === 0 ? '' : row.make_model } };
}

app.post('/api/cases/:id/offer', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const actionError = validateCaseAction('assign', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const withAgent = await queryOne(pool, 'SELECT 1 FROM case_assignments WHERE case_id = ? AND active = 1 LIMIT 1', [caseRow.id]);
  if (withAgent || !OFFERABLE_STATUSES.includes(caseRow.status)) return res.status(422).json({ error: 'Only a case with no agent can be offered to all agents.' });
  const agents = await query(pool, "SELECT users.id FROM agent_memberships m JOIN users ON users.id = m.agent_user_id WHERE m.tenant_id = ? AND m.active = 1 AND users.active = 1 AND users.role = 'agent'", [req.user.tenantId]);
  if (!agents.length) return res.status(422).json({ error: 'Add active agents to your roster first.' });
  const offeredAt = isoNow();
  await tx(pool, async (conn) => {
    await query(conn, 'UPDATE recovery_cases SET open_offer_at = ?, open_offer_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [offeredAt, req.user.id, offeredAt, caseRow.id, req.user.tenantId]);
    for (const agent of agents) await addNotification(conn, { tenantId: req.user.tenantId, recipientUserId: agent.id, title: 'Open case available', detail: `${caseRow.registration} (${caseRow.branch}) is open. The first agent to accept gets it.`, tone: 'blue' });
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.offered', detail: `Offered to ${agents.length} active agent(s).` });
  });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])), notified: agents.length });
});

app.delete('/api/cases/:id/offer', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  await query(pool, 'UPDATE recovery_cases SET open_offer_at = NULL, open_offer_by_user_id = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?', [isoNow(), caseRow.id, req.user.tenantId]);
  await addAudit(pool, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.offer_withdrawn', detail: 'Open offer withdrawn.' });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/cases/:id/accept-offer', auth, requirePermission(PERMISSIONS.ASSIGNMENT_RESPOND), async (req, res, next) => {
  try {
    const body = await tx(pool, async (conn) => {
      const caseRow = await queryOne(conn, 'SELECT * FROM recovery_cases WHERE id = ? FOR UPDATE', [req.params.id]);
      const member = caseRow && await queryOne(conn, 'SELECT 1 FROM agent_memberships WHERE tenant_id = ? AND agent_user_id = ? AND active = 1', [caseRow.tenant_id, req.user.id]);
      if (!caseRow || !member) throw offerError(404, 'Case not found.');
      const taken = await queryOne(conn, 'SELECT 1 FROM case_assignments WHERE case_id = ? AND active = 1 LIMIT 1', [caseRow.id]);
      if (!caseRow.open_offer_at || taken || caseRow.billing_locked || !OFFERABLE_STATUSES.includes(caseRow.status)) throw offerError(409, 'This case is no longer open. Another agent may have accepted it.');
      const acceptedAt = isoNow();
      await query(conn, 'INSERT INTO case_assignments (tenant_id, case_id, agent_user_id, assigned_at, assigned_by_user_id, note, active) VALUES (?, ?, ?, ?, ?, ?, 1)', [caseRow.tenant_id, caseRow.id, req.user.id, acceptedAt, caseRow.open_offer_by_user_id, caseRow.assignment_note]);
      await query(conn, "UPDATE recovery_cases SET status = 'assigned', assigned_agent_user_id = ?, assigned_at = ?, updated_at = ?, failure_reason = NULL, failure_note = NULL, failure_recorded_at = NULL, open_offer_at = NULL, open_offer_by_user_id = NULL WHERE id = ?", [req.user.id, acceptedAt, acceptedAt, caseRow.id]);
      await addNotification(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, title: 'Open case accepted', detail: `${req.user.name} accepted ${caseRow.id} (${caseRow.registration}).`, tone: 'green' });
      await addAudit(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.offer_accepted', detail: `${req.user.name} accepted the open case.` });
      return { caseId: caseRow.id };
    });
    return res.json(body);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

app.put('/api/cases/:id/agent-visibility', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  const caseRow = await caseForUser(req.params.id, req.user);
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const { customer, vehicle } = req.body ?? {};
  if (typeof customer !== 'boolean' || typeof vehicle !== 'boolean') return res.status(422).json({ error: 'Choose what the agent can see.' });
  await query(pool, 'UPDATE recovery_cases SET share_customer = ?, share_vehicle = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [customer ? 1 : 0, vehicle ? 1 : 0, isoNow(), caseRow.id, req.user.tenantId]);
  await addAudit(pool, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.visibility_changed', detail: `Agent sees customer details: ${customer ? 'yes' : 'no'}; vehicle details: ${vehicle ? 'yes' : 'no'}.` });
  res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])) });
});

app.post('/api/ratings', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  const jobType = req.body?.jobType === 'verification' ? 'verification' : 'case';
  const jobId = String(req.body?.jobId || req.body?.caseId || '');
  const job = jobType === 'verification' ? await verificationForUser(jobId, req.user) : await caseForUser(jobId, req.user);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  try {
    const rating = await rateAgent({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, jobType, jobId: job.id, agentId: String(req.body?.agentId || ''), stars: req.body?.stars, comment: req.body?.comment });
    await addAudit(pool, { tenantId: req.user.tenantId, caseId: jobType === 'case' ? job.id : null, actorUserId: req.user.id, action: 'agent.rated', detail: `Rated the agent ${rating.stars}/5 for ${job.id}.` });
    return res.status(201).json({ rating });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The rating could not be saved.' });
  }
});

// ---- House / location verification ----
async function verificationForUser(id, user) {
  const request = await queryOne(pool, 'SELECT * FROM verification_requests WHERE id = ?', [id]);
  if (!request) return null;
  if (user.role === 'agent') {
    if (request.assigned_agent_user_id !== user.id) return null;
    const suspended = await queryOne(pool, 'SELECT 1 FROM agent_memberships WHERE agent_user_id = ? AND tenant_id = ? AND active = 0', [user.id, request.tenant_id]);
    return suspended ? null : request;
  }
  return request.tenant_id === user.tenantId ? request : null;
}

const verificationRow = (id) => queryOne(pool, 'SELECT v.*, a.name AS agent_name FROM verification_requests v LEFT JOIN users a ON a.id = v.assigned_agent_user_id WHERE v.id = ?', [id]);

app.post('/api/verifications', auth, requirePermission(PERMISSIONS.CASE_CREATE), async (req, res) => {
  try {
    const { id, billing } = await createVerification({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, values: req.body ?? {} });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'verification.created', detail: `House verification ${id} requested.${billing.pending ? ' Locked until the wallet is recharged.' : ''}` });
    return res.status(201).json({ verification: mapVerification(await verificationRow(id), formatMobile), billing });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The verification request could not be created.' });
  }
});

app.put('/api/verifications/:id/assignment', auth, requirePermission(PERMISSIONS.CASE_ASSIGN), async (req, res) => {
  try {
    const assigned = await assignVerification({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, requestId: req.params.id, agentId: String(req.body?.agentId || '') });
    await addNotification(pool, { tenantId: req.user.tenantId, recipientUserId: assigned.agentId, title: 'New house verification', detail: `${assigned.id}: visit the customer's address and verify it with GPS and photos.`, tone: 'blue' });
    if (assigned.previousAgentId && assigned.previousAgentId !== assigned.agentId) await addNotification(pool, { tenantId: req.user.tenantId, recipientUserId: assigned.previousAgentId, title: 'Verification reassigned', detail: `${assigned.id} was moved to another agent.`, tone: 'amber' });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'verification.assigned', detail: `${assigned.id} assigned to an agent.` });
    return res.json({ verification: mapVerification(await verificationRow(assigned.id), formatMobile) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request could not be assigned.';
    return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message });
  }
});

app.post('/api/verifications/:id/cancel', auth, requirePermission(PERMISSIONS.CASE_CREATE), async (req, res) => {
  const request = await verificationForUser(req.params.id, req.user);
  if (!request) return res.status(404).json({ error: 'Verification request not found.' });
  try {
    await cancelVerification({ database: pool, tenantId: req.user.tenantId, requestId: request.id });
    if (request.assigned_agent_user_id) await addNotification(pool, { tenantId: req.user.tenantId, recipientUserId: request.assigned_agent_user_id, title: 'Verification cancelled', detail: `${request.id} was cancelled by the financer.`, tone: 'amber' });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'verification.cancelled', detail: `${request.id} cancelled (platform fee not refunded).` });
    return res.json({ verification: mapVerification(await verificationRow(request.id), formatMobile) });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The request could not be cancelled.' });
  }
});

async function loadAssignedVerification(req, res, next) {
  const request = await verificationForUser(req.params.id, req.user);
  if (!request || request.assigned_agent_user_id !== req.user.id) return res.status(404).json({ error: 'Verification request not found.' });
  // Status is checked after requireFieldMutation, so a retried submit replays its saved result instead of failing.
  req.verification = request;
  return next();
}

app.post('/api/verifications/:id/submit', auth, requirePermission(PERMISSIONS.ATTEMPT_SUBMIT), loadAssignedVerification, requireFieldMutation('verification'), upload.array('files', VERIFICATION_PHOTOS.max), async (req, res, next) => {
  const files = req.files ?? [];
  const request = req.verification;
  const reject = (message) => { deleteUploads(files); return res.status(422).json({ error: message }); };
  if (request.status !== 'assigned') return reject('This verification is no longer an active assignment.');
  if (files.some((file) => !file.mimetype.startsWith('image/') || !isAllowedEvidenceFile(readFileSync(file.path), file.mimetype))) return reject('Upload JPG, PNG or WebP photos only.');
  const location = readLocation(req.body);
  if (location.error) return reject(location.error);
  const result = String(req.body?.result || '');
  const note = String(req.body?.note || '').trim();
  const invalid = validateVerificationSubmission({ result, note, photoCount: files.length });
  if (invalid) return reject(invalid);
  const capturedAt = String(req.body?.capturedAt || isoNow());
  if (Number.isNaN(Date.parse(capturedAt))) return reject('Photo capture time is invalid.');
  const submittedAt = isoNow();
  const verified = result === 'verified';
  try {
    const body = await tx(pool, async (conn) => {
      for (const file of files) {
        await query(conn, 'INSERT INTO verification_evidence (id, tenant_id, request_id, agent_user_id, file_name, original_name, mime_type, byte_size, latitude, longitude, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`ve-${crypto.randomUUID()}`, request.tenant_id, request.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size, location.latitude, location.longitude, capturedAt]);
      }
      const updated = await query(conn, "UPDATE verification_requests SET status = 'submitted', result = ?, result_note = ?, latitude = ?, longitude = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'assigned'",
        [result, note, location.latitude, location.longitude, submittedAt, submittedAt, request.id]);
      if (updated.affectedRows !== 1) throw new Error('The verification could not be updated.');
      await addNotification(conn, { tenantId: request.tenant_id, title: verified ? 'Location verified' : 'Location could not be verified', detail: `${request.reference} · ${request.customer_name}: ${note}`, tone: verified ? 'green' : 'amber' });
      await addAudit(conn, { tenantId: request.tenant_id, actorUserId: req.user.id, action: 'verification.submitted', detail: `${request.id} ${verified ? 'verified' : 'not verified'} at GPS ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} with ${files.length} photo(s).` });
      const response = { verification: mapVerification(await queryOne(conn, 'SELECT * FROM verification_requests WHERE id = ?', [request.id]), formatMobile) };
      await saveFieldMutation(conn, { ...req.fieldMutation, statusCode: 201, body: response, createdAt: submittedAt });
      return response;
    });
    return res.status(201).json(body);
  } catch (error) {
    deleteUploads(files);
    return next(error);
  }
});

app.get('/api/verifications/:id/evidence', auth, async (req, res) => {
  const request = await verificationForUser(req.params.id, req.user);
  if (!request) return res.status(404).json({ error: 'Verification request not found.' });
  const rows = await query(pool, 'SELECT e.*, users.name AS agent_name FROM verification_evidence e JOIN users ON users.id = e.agent_user_id WHERE e.request_id = ? ORDER BY e.captured_at', [request.id]);
  res.json({ evidence: rows.map((row) => ({ ...mapEvidence(row), caseId: row.request_id })) });
});

app.get('/api/verification-evidence/:id/file', auth, async (req, res) => {
  const evidence = await queryOne(pool, 'SELECT * FROM verification_evidence WHERE id = ?', [req.params.id]);
  if (!evidence || !(await verificationForUser(evidence.request_id, req.user))) return res.status(404).json({ error: 'Photo not found.' });
  res.type(evidence.mime_type).sendFile(join(uploadDirectory, evidence.file_name));
});

// ---- API keys: management (tenant owner) and the external v1 API ----
app.get('/api/api-keys', auth, requirePermission(PERMISSIONS.ORGANIZATION_MANAGE), async (req, res) => {
  res.json({ keys: await listApiKeys(pool, req.user.tenantId), allowance: await apiKeyAllowance(pool, req.user.tenantId) });
});

app.post('/api/api-keys/requests', auth, requirePermission(PERMISSIONS.ORGANIZATION_MANAGE), async (req, res) => {
  try {
    const request = await requestExtraApiKey({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, reason: req.body?.reason });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'api_key.requested', detail: 'Requested approval for an additional API key.' });
    return res.status(201).json({ request });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The request could not be sent.' });
  }
});

app.post('/api/api-keys', auth, requirePermission(PERMISSIONS.ORGANIZATION_MANAGE), async (req, res) => {
  try {
    const key = await createApiKey({ database: pool, tenantId: req.user.tenantId, userId: req.user.id, name: req.body?.name });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'api_key.created', detail: `API key "${key.name}" (${key.keyPrefix}…) was created.` });
    return res.status(201).json({ key });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'The API key could not be created.' });
  }
});

app.delete('/api/api-keys/:id', auth, requirePermission(PERMISSIONS.ORGANIZATION_MANAGE), async (req, res) => {
  try {
    await revokeApiKey({ database: pool, tenantId: req.user.tenantId, keyId: req.params.id });
    await addAudit(pool, { tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'api_key.revoked', detail: 'An API key was revoked.' });
    return res.status(204).end();
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : 'API key not found.' });
  }
});

async function apiKeyAuth(req, res, next) {
  const key = await findActiveApiKey(pool, String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!key) return res.status(401).json({ error: 'A valid API key is required.' });
  req.apiKey = key;
  await query(pool, 'UPDATE api_keys SET last_used_at = ? WHERE id = ?', [isoNow(), key.id]);
  return next();
}
const apiKeyLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, key: (req) => req.apiKey?.id ?? clientKey(req) });
const MAX_API_BATCH = 1000;

// Upserts by account number, exactly like a spreadsheet import; every accepted row is billed.
app.post('/api/v1/cases', apiKeyAuth, apiKeyLimiter, async (req, res, next) => {
  const list = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.cases) ? req.body.cases : req.body && typeof req.body === 'object' ? [req.body] : [];
  if (!list.length || list.length > MAX_API_BATCH) return res.status(422).json({ error: `Send between 1 and ${MAX_API_BATCH} cases per request.` });
  const normalized = normalizeAccountRows(list);
  const errors = normalized.errors.map((error) => ({ index: error.row - 2, message: error.message }));
  if (!normalized.valid.length) return res.status(422).json({ error: 'No valid cases were found.', errors });
  const now = new Date();
  try {
    const result = await importMonthlyRows({
      database: pool,
      tenantId: req.apiKey.tenant_id,
      actorUserId: req.apiKey.created_by_user_id,
      snapshotMonth: `${now.toISOString().slice(0, 7)}-01`,
      fileName: `API · ${req.apiKey.name}`,
      fileSha256: createHash('sha256').update(`${req.apiKey.id}:${now.toISOString()}:${randomUUID()}`).digest('hex'),
      rows: normalized.valid,
      rejectedRows: errors.length,
      itemType: 'case_api',
      now,
    });
    await addAudit(pool, { tenantId: req.apiKey.tenant_id, actorUserId: req.apiKey.created_by_user_id, action: 'api.cases_pushed', detail: `${req.apiKey.name}: ${result.accepted} accepted (${result.created} new, ${result.updated} updated), ${result.rejected} rejected.` });
    return res.status(201).json({ accepted: result.accepted, rejected: result.rejected, created: result.created, updated: result.updated, billing: result.billing, errors });
  } catch (error) {
    return next(error);
  }
});

// "Remove" = cancel, and only while no agent has the case. The charge is not refunded.
app.delete('/api/v1/cases/:accountNumber', apiKeyAuth, apiKeyLimiter, async (req, res) => {
  const tenantId = req.apiKey.tenant_id;
  const caseRow = await queryOne(pool, "SELECT * FROM recovery_cases WHERE tenant_id = ? AND account_number = ? AND status NOT IN ('closed', 'cancelled') ORDER BY updated_at DESC LIMIT 1", [tenantId, String(req.params.accountNumber).trim()]);
  if (!caseRow) return res.status(404).json({ error: 'No open case uses this account number.' });
  const withAgent = await queryOne(pool, 'SELECT 1 FROM case_assignments WHERE case_id = ? AND active = 1 LIMIT 1', [caseRow.id]);
  if (caseRow.status !== 'imported' || withAgent) return res.status(409).json({ error: 'This case is already with an agent. Manage it in Handoff.' });
  await query(pool, "UPDATE recovery_cases SET status = 'cancelled', updated_at = ? WHERE id = ? AND tenant_id = ?", [isoNow(), caseRow.id, tenantId]);
  await addAudit(pool, { tenantId, caseId: caseRow.id, actorUserId: req.apiKey.created_by_user_id, action: 'api.case_cancelled', detail: `${req.apiKey.name} cancelled account ${caseRow.account_number}.` });
  return res.json({ id: caseRow.id, accountNumber: caseRow.account_number, status: 'cancelled' });
});

app.get('/api/v1/cases', apiKeyAuth, apiKeyLimiter, async (req, res) => {
  const status = String(req.query.status || '');
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = status
    ? await query(pool, 'SELECT * FROM recovery_cases WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?', [req.apiKey.tenant_id, status, limit])
    : await query(pool, 'SELECT * FROM recovery_cases WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?', [req.apiKey.tenant_id, limit]);
  res.json({ cases: rows.map((row) => ({ id: row.id, accountNumber: row.account_number, borrowerName: row.borrower_name, registration: row.registration, status: row.status, billingLocked: Boolean(row.billing_locked), createdAt: row.created_at ?? row.updated_at, updatedAt: row.updated_at })) });
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
  if (!caseRow) return res.status(404).json({ error: 'Recovery case not found.' });
  const assignmentNote = String(req.body?.assignmentNote || '').trim();
  const actionError = validateCaseAction('assign', caseRow, { assignmentNote });
  if (actionError) return res.status(422).json({ error: actionError });
  const agentIds = Array.isArray(req.body?.agentIds) ? req.body.agentIds.map(String).filter(Boolean) : (req.body?.agentId ? [String(req.body.agentId)] : []);
  if (!agentIds.length) return res.status(422).json({ error: 'Choose at least one agent.' });
  const rosterAgents = await query(pool, "SELECT users.id, users.name FROM users JOIN agent_memberships m ON m.agent_user_id = users.id AND m.tenant_id = ? AND m.active = 1 WHERE users.id IN (?) AND users.role = 'agent' AND users.active = 1", [req.user.tenantId, agentIds]);
  if (rosterAgents.length !== new Set(agentIds).size) return res.status(422).json({ error: 'Choose active agents from your roster.' });
  const nameById = new Map(rosterAgents.map((agent) => [agent.id, agent.name]));
  const updatedAt = isoNow();
  await tx(pool, async (conn) => {
    const currentActive = (await query(conn, 'SELECT agent_user_id FROM case_assignments WHERE case_id = ? AND tenant_id = ? AND active = 1', [caseRow.id, req.user.tenantId])).map((row) => row.agent_user_id);
    const desired = new Set(agentIds);
    for (const id of currentActive.filter((current) => !desired.has(current))) {
      await query(conn, 'UPDATE case_assignments SET active = 0, unassigned_at = ? WHERE case_id = ? AND tenant_id = ? AND agent_user_id = ? AND active = 1', [updatedAt, caseRow.id, req.user.tenantId, id]);
    }
    for (const id of agentIds.filter((wanted) => !currentActive.includes(wanted))) {
      await query(conn, 'INSERT INTO case_assignments (tenant_id, case_id, agent_user_id, assigned_at, assigned_by_user_id, note, active) VALUES (?, ?, ?, ?, ?, ?, 1)', [req.user.tenantId, caseRow.id, id, updatedAt, req.user.id, assignmentNote || null]);
      await addNotification(conn, { tenantId: req.user.tenantId, recipientUserId: id, caseId: caseRow.id, title: 'New recovery case assigned', detail: `${caseRow.id} has been assigned to you by the finance team.`, tone: 'blue' });
    }
    await query(conn, "UPDATE recovery_cases SET status = 'assigned', assigned_agent_user_id = ?, assigned_at = ?, assignment_note = ?, updated_at = ?, failure_reason = NULL, failure_note = NULL, failure_recorded_at = NULL, open_offer_at = NULL, open_offer_by_user_id = NULL WHERE id = ? AND tenant_id = ?",
      [agentIds[0], updatedAt, assignmentNote || null, updatedAt, caseRow.id, req.user.tenantId]);
    await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'case.assigned', detail: `Assigned to ${agentIds.map((id) => nameById.get(id)).join(', ')}.${assignmentNote ? ` Instruction: ${assignmentNote}` : ''}` });
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
      [reason, note, updatedAt, updatedAt, caseRow.id, caseRow.tenant_id]);
    await addNotification(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, title: 'Recovery attempt could not be completed', detail: `${caseRow.id} was marked ${reason.toLowerCase()} by ${req.user.name}.`, tone: 'amber' });
    await addAudit(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, actorUserId: req.user.id, action: 'attempt.failed', detail: `${reason}: ${note}${locationDetail}` });
    const response = { case: redactForAgent(mapCase(await queryOne(conn, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id]))) };
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
  const location = readLocation(req.body);
  if (location.error) {
    deleteUploads(files);
    return res.status(422).json({ error: location.error });
  }
  const { latitude, longitude } = location;
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
          [id, req.recoveryCase.tenant_id, req.recoveryCase.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size, latitude, longitude, capturedAt]);
        records.push(mapEvidence(await queryOne(conn, 'SELECT * FROM evidence WHERE id = ?', [id])));
      }
      await addAudit(conn, { tenantId: req.recoveryCase.tenant_id, caseId: req.recoveryCase.id, actorUserId: req.user.id, action: 'evidence.uploaded', detail: `${records.length} field evidence file(s) captured.` });
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
  const records = await query(pool, 'SELECT evidence.*, users.name AS agent_name FROM evidence JOIN users ON users.id = evidence.agent_user_id WHERE evidence.tenant_id = ? AND evidence.case_id = ? ORDER BY evidence.captured_at DESC', [caseRow.tenant_id, caseRow.id]);
  res.json({ evidence: records.map(mapEvidence) });
});

app.get('/api/evidence/:id/file', auth, async (req, res) => {
  const evidence = await queryOne(pool, 'SELECT * FROM evidence WHERE id = ?', [req.params.id]);
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
  const evidenceCount = (await queryOne(pool, 'SELECT COUNT(*) AS count FROM evidence WHERE tenant_id = ? AND case_id = ?', [caseRow.tenant_id, caseRow.id])).count;
  const validationError = validateCustody(caseRow, { yardName, arrivalTime, parkingRate, checklist, inspection, evidenceCount, customNote });
  if (validationError) return res.status(422).json({ error: validationError });
  const location = readLocation(req.body);
  if (location.error) return res.status(422).json({ error: location.error });
  const { latitude, longitude } = location;
  const id = `CT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const createdAt = isoNow();
  const locationDetail = ` GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.`;
  try {
    const body = await tx(pool, async (conn) => {
      await persistCustody(conn, { id, tenantId: caseRow.tenant_id, caseId: caseRow.id, yardName, arrivalTime, parkingRate, createdAt, agentName: req.user.name, checklist, inspection, customNote, latitude, longitude });
      await addNotification(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, title: 'Custody report submitted', detail: `${caseRow.id} was submitted by ${req.user.name} and is awaiting finance review.`, tone: 'green' });
      await addAudit(conn, { tenantId: caseRow.tenant_id, caseId: caseRow.id, actorUserId: req.user.id, action: 'custody.created', detail: `Created ${id} at ${yardName}.${locationDetail}` });
      const response = { case: redactForAgent(mapCase(await queryOne(conn, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id]))), custody: mapCustody(await queryOne(conn, 'SELECT * FROM custody_records WHERE id = ?', [id])) };
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
  // Idempotent: a case holds at most one pass (unique case_id). If one already exists — a
  // re-issue, a double-click, or a concurrent request — return it instead of erroring.
  const passByCase = () => queryOne(pool, 'SELECT release_passes.*, users.name AS issued_by_name FROM release_passes LEFT JOIN users ON users.id = release_passes.issued_by_user_id WHERE release_passes.tenant_id = ? AND release_passes.case_id = ?', [req.user.tenantId, caseRow.id]);
  const existingPass = await passByCase();
  if (existingPass) return res.json({ case: mapCase(caseRow), releasePass: mapReleasePass(existingPass) });
  const actionError = validateCaseAction('issue_release', caseRow);
  if (actionError) return res.status(422).json({ error: actionError });
  const passId = `RP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const verificationCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const updatedAt = isoNow();
  const exp = new Date(Date.now() + RELEASE_TTL_MS).toISOString();
  const signedToken = releaseSigner.configured ? releaseSigner.sign({ passId, orgId: req.user.tenantId, issuedAt: updatedAt, exp, reg: String(caseRow.registration).slice(-4) }) : null;
  try {
    await tx(pool, async (conn) => {
      await persistReleasePass(conn, { id: passId, tenantId: req.user.tenantId, caseId: caseRow.id, issuedByUserId: req.user.id, verificationCode, issuedAt: updatedAt, borrowerName: caseRow.borrower_name, borrowerMobile: caseRow.borrower_mobile, vehicleRegistration: caseRow.registration, vehicleModel: caseRow.make_model, custodyId: caseRow.custody_id, paymentReference: caseRow.payment_reference, signedToken, keyId: releaseSigner.keyId });
      await addNotification(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, title: 'Release pass issued', detail: `${passId} is ready to print for ${caseRow.borrower_name}.`, tone: 'green' });
      await addAudit(conn, { tenantId: req.user.tenantId, caseId: caseRow.id, actorUserId: req.user.id, action: 'release_pass.issued', detail: `Issued ${passId}.` });
    });
  } catch (error) {
    // Lost a concurrent race on the unique(case_id) constraint — return the winner's pass.
    const raced = await passByCase();
    if (raced) return res.json({ case: mapCase(await queryOne(pool, 'SELECT * FROM recovery_cases WHERE id = ?', [caseRow.id])), releasePass: mapReleasePass(raced) });
    throw error;
  }
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

app.get('/r/:token', verifyPageLimiter, async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
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

// Published agent APK (build output, gitignored): https://<site>/download/handoff-field.apk
app.use('/download', express.static(join(appDirectory, 'downloads')));

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
await ensurePlatformAdmin(process.env.PLATFORM_ADMIN_MOBILE);

// The platform operator (who confirms wallet top-ups) is bootstrapped from .env, never self-registered.
async function ensurePlatformAdmin(mobile) {
  if (!mobile) return;
  const mobileE164 = normalizeIndiaMobile(mobile);
  const existing = await queryOne(pool, 'SELECT id, role FROM users WHERE mobile_e164 = ?', [mobileE164]);
  if (existing) {
    if (existing.role !== 'platform_admin') console.error(`PLATFORM_ADMIN_MOBILE already belongs to a ${existing.role} account; platform admin was not created.`);
    return;
  }
  const id = `platform-${randomUUID()}`;
  await query(pool, "INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164, onboarding_complete, created_via) VALUES (?, NULL, 'platform_admin', 'Platform admin', ?, 'otp-only', ?, '', 1, ?, 1, 'platform')",
    [id, `${id}@handoff.invalid`, formatMobile(mobileE164), mobileE164]);
}
app.listen(port, config.listenHost, () => console.log(`Handoff API listening on http://${config.listenHost}:${port}`));
