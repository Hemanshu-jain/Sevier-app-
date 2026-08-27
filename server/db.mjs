import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { ensureMonthlyImportSchema } from './monthly-import.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const dataDirectory = join(directory, 'data');
const backupDirectory = join(directory, 'backups');
mkdirSync(dataDirectory, { recursive: true });
mkdirSync(backupDirectory, { recursive: true });

const databasePath = join(dataDirectory, 'seizer.db');
export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    role TEXT NOT NULL CHECK(role IN ('super_admin', 'finance_manager', 'finance_staff', 'agent')),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    mobile TEXT,
    city TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS recovery_cases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    account_number TEXT NOT NULL,
    borrower_name TEXT NOT NULL,
    borrower_mobile TEXT NOT NULL,
    borrower_address TEXT NOT NULL,
    registration TEXT NOT NULL,
    make_model TEXT NOT NULL,
    chassis TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('2-wheeler', '4-wheeler')),
    branch TEXT NOT NULL,
    pending_amount INTEGER NOT NULL,
    overdue_days INTEGER NOT NULL,
    status TEXT NOT NULL,
    assigned_agent_user_id TEXT REFERENCES users(id),
    assigned_at TEXT,
    updated_at TEXT NOT NULL,
    custody_id TEXT,
    failure_reason TEXT,
    failure_note TEXT,
    failure_recorded_at TEXT,
    payment_cleared INTEGER NOT NULL DEFAULT 0,
    release_pass_id TEXT
  );
  CREATE TABLE IF NOT EXISTS custody_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    case_id TEXT NOT NULL UNIQUE REFERENCES recovery_cases(id),
    yard_name TEXT NOT NULL,
    arrival_time TEXT NOT NULL,
    parking_rate INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    checklist_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    recipient_user_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    tone TEXT NOT NULL CHECK(tone IN ('blue', 'amber', 'green', 'red'))
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    case_id TEXT REFERENCES recovery_cases(id),
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    case_id TEXT NOT NULL REFERENCES recovery_cases(id),
    agent_user_id TEXT NOT NULL REFERENCES users(id),
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    latitude REAL,
    longitude REAL,
    captured_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS evidence_case_index ON evidence(tenant_id, case_id, captured_at DESC);
  CREATE TABLE IF NOT EXISTS release_passes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    case_id TEXT NOT NULL UNIQUE REFERENCES recovery_cases(id),
    issued_by_user_id TEXT REFERENCES users(id),
    verification_code TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    borrower_name TEXT NOT NULL,
    borrower_mobile TEXT NOT NULL,
    vehicle_registration TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    custody_id TEXT,
    payment_reference TEXT
  );
  CREATE INDEX IF NOT EXISTS release_pass_tenant_index ON release_passes(tenant_id, issued_at DESC);
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

const custodyColumns = db.prepare('PRAGMA table_info(custody_records)').all().map((column) => column.name);
if (!custodyColumns.includes('inspection_json')) {
  db.exec('ALTER TABLE custody_records ADD COLUMN inspection_json TEXT');
}

const caseColumns = db.prepare('PRAGMA table_info(recovery_cases)').all().map((column) => column.name);
if (!caseColumns.includes('payment_reference')) db.exec('ALTER TABLE recovery_cases ADD COLUMN payment_reference TEXT');
if (!caseColumns.includes('payment_confirmed_at')) db.exec('ALTER TABLE recovery_cases ADD COLUMN payment_confirmed_at TEXT');
if (!caseColumns.includes('payment_confirmed_by_user_id')) db.exec('ALTER TABLE recovery_cases ADD COLUMN payment_confirmed_by_user_id TEXT REFERENCES users(id)');
if (!caseColumns.includes('authority_document_file_name')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_document_file_name TEXT');
if (!caseColumns.includes('authority_document_original_name')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_document_original_name TEXT');
if (!caseColumns.includes('authority_document_mime_type')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_document_mime_type TEXT');
if (!caseColumns.includes('authority_document_byte_size')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_document_byte_size INTEGER');
if (!caseColumns.includes('authority_document_sha256')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_document_sha256 TEXT');
if (!caseColumns.includes('authority_approved_at')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_approved_at TEXT');
if (!caseColumns.includes('authority_approved_by_user_id')) db.exec('ALTER TABLE recovery_cases ADD COLUMN authority_approved_by_user_id TEXT REFERENCES users(id)');
if (!caseColumns.includes('assignment_note')) db.exec('ALTER TABLE recovery_cases ADD COLUMN assignment_note TEXT');

const currentCustodyColumns = db.prepare('PRAGMA table_info(custody_records)').all().map((column) => column.name);
if (!currentCustodyColumns.includes('finance_reviewed_at')) db.exec('ALTER TABLE custody_records ADD COLUMN finance_reviewed_at TEXT');
if (!currentCustodyColumns.includes('finance_reviewed_by_user_id')) db.exec('ALTER TABLE custody_records ADD COLUMN finance_reviewed_by_user_id TEXT REFERENCES users(id)');
if (!currentCustodyColumns.includes('finance_review_note')) db.exec('ALTER TABLE custody_records ADD COLUMN finance_review_note TEXT');

ensureMonthlyImportSchema(db);

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumns.includes('mobile_e164')) db.exec('ALTER TABLE users ADD COLUMN mobile_e164 TEXT');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_mobile_e164_unique ON users(mobile_e164) WHERE mobile_e164 IS NOT NULL;
  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    mobile_e164 TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'sign_in' CHECK(purpose IN ('sign_in', 'sign_up')),
    provider_request_id TEXT,
    requested_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    request_ip TEXT
  );
  CREATE INDEX IF NOT EXISTS otp_challenges_mobile_time ON otp_challenges(mobile_e164, requested_at DESC);
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
`);
const otpChallengeColumns = db.prepare('PRAGMA table_info(otp_challenges)').all().map((column) => column.name);
if (!otpChallengeColumns.includes('purpose')) db.exec("ALTER TABLE otp_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign_in'");

function now() {
  return new Date().toISOString();
}

function seedIfEmpty() {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (existing.count > 0) return;

  const passwordHash = bcrypt.hashSync('demo123', 10);
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run('tenant-aarya', 'Aarya Finance Pvt. Ltd.');
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run('tenant-sample', 'Sample Finserv Ltd.');

  const users = [
    ['user-admin', 'tenant-aarya', 'super_admin', 'Arun Mehta', 'admin@aaryafinance.test', '+91 98450 11111', 'Bengaluru'],
    ['user-manager', 'tenant-aarya', 'finance_manager', 'Divya Rao', 'manager@aaryafinance.test', '+91 98450 11112', 'Bengaluru'],
    ['agent-1', 'tenant-aarya', 'agent', 'Ravi Kumar', 'ravi@field.test', '+91 98451 22014', 'Bengaluru'],
    ['agent-2', 'tenant-aarya', 'agent', 'Ayesha Shaikh', 'ayesha@field.test', '+91 99018 45107', 'Bengaluru'],
    ['agent-3', 'tenant-aarya', 'agent', 'Naveen Reddy', 'naveen@field.test', '+91 97319 00682', 'Mysuru'],
    ['sample-admin', 'tenant-sample', 'super_admin', 'Sample Finserv Admin', 'admin@samplefinserv.test', '+91 90000 10000', 'Chennai'],
  ];
  const insertUser = db.prepare('INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const user of users) insertUser.run(...user.slice(0, 5), passwordHash, ...user.slice(5));

  const cases = [
    ['RC-260801', 'LN-801449', 'Meera Iyer', '+91 98450 21736', '4th Cross, HSR Layout, Bengaluru', 'KA 01 MQ 4281', '2023 Honda Activa 6G', 'ME4JF90A6P8A04421', '2-wheeler', 'HSR Layout', 38400, 97, 'Assigned', 'agent-1', '2026-08-10T09:12:00.000Z', '2026-08-10T09:12:00.000Z', null, null, null, null, 0, null],
    ['RC-260798', 'LN-801402', 'Arjun Nair', '+91 99801 76423', '2nd Main, Vijayanagar, Bengaluru', 'KA 02 HK 9024', '2022 Tata Nexon XZ+', 'MAT626404NWB40168', '4-wheeler', 'Vijayanagar', 178250, 124, 'Attempt in progress', 'agent-2', '2026-08-09T17:40:00.000Z', '2026-08-10T10:05:00.000Z', null, null, null, null, 0, null],
    ['RC-260792', 'LN-801356', 'Shashank Rao', '+91 99000 88921', 'JP Nagar Phase 7, Bengaluru', 'KA 05 JJ 6810', '2021 TVS Apache RTR 160', 'MD634KE47M2B59138', '2-wheeler', 'JP Nagar', 24600, 88, 'Unable to recover', 'agent-1', '2026-08-10T08:45:00.000Z', '2026-08-10T10:05:00.000Z', null, 'Vehicle not found', 'Address verified. Neighbours have not seen the vehicle for three days.', '2026-08-10T10:05:00.000Z', 0, null],
    ['RC-260787', 'LN-801309', 'Kavya Menon', '+91 98442 36157', 'Indiranagar 100 Ft Road, Bengaluru', 'KA 03 PN 4125', '2020 Hyundai Venue SX', 'MALPC813LLM207452', '4-wheeler', 'Indiranagar', 121900, 113, 'Payment pending', 'agent-3', '2026-08-05T08:10:00.000Z', '2026-08-09T14:10:00.000Z', 'CT-260078', null, null, null, 0, null],
    ['RC-260780', 'LN-801250', 'Rohit Kulkarni', '+91 97408 05513', 'Yelahanka New Town, Bengaluru', 'KA 04 SB 7789', '2021 Royal Enfield Classic 350', 'ME3U3S5C2M1D80128', '2-wheeler', 'Yelahanka', 42750, 64, 'Imported', null, null, '2026-08-09T07:10:00.000Z', null, null, null, null, 0, null],
    ['RC-260774', 'LN-801184', 'Farah Ali', '+91 99867 42018', 'Kengeri Satellite Town, Bengaluru', 'KA 41 Q 1146', '2022 Suzuki Access 125', 'MB8DP11A3P8F92174', '2-wheeler', 'Kengeri', 31200, 73, 'Custody certificate issued', 'agent-2', '2026-08-05T12:00:00.000Z', '2026-08-05T15:32:00.000Z', 'CT-260077', null, null, null, 0, null],
  ];
  const insertCase = db.prepare(`INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address, registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, assigned_agent_user_id, assigned_at, updated_at, custody_id, failure_reason, failure_note, failure_recorded_at, payment_cleared, release_pass_id) VALUES (?, 'tenant-aarya', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const recoveryCase of cases) insertCase.run(...recoveryCase);

  const insertCustody = db.prepare('INSERT INTO custody_records (id, tenant_id, case_id, yard_name, arrival_time, parking_rate, created_at, agent_name, checklist_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertCustody.run('CT-260078', 'tenant-aarya', 'RC-260787', 'Sri Lakshmi Parking, Yeshwanthpur', '2026-08-05T18:25:00.000Z', 350, '2026-08-05T18:41:00.000Z', 'Naveen Reddy', 14);
  insertCustody.run('CT-260077', 'tenant-aarya', 'RC-260774', 'Sri Lakshmi Parking, Yeshwanthpur', '2026-08-05T15:18:00.000Z', 350, '2026-08-05T15:32:00.000Z', 'Ayesha Shaikh', 14);

  const insertNotification = db.prepare('INSERT INTO notifications (id, tenant_id, recipient_user_id, title, detail, created_at, read, tone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertNotification.run('n-1', 'tenant-aarya', null, 'Custody report submitted', 'RC-260787 was submitted by Naveen Reddy and is awaiting your review.', '2026-08-10T11:42:00.000Z', 0, 'green');
  insertNotification.run('n-2', 'tenant-aarya', null, 'Recovery attempt could not be completed', 'RC-260792 was marked Vehicle not found with a field note.', '2026-08-10T10:25:00.000Z', 0, 'amber');
  insertNotification.run('n-3', 'tenant-aarya', 'agent-1', 'New case assigned', 'RC-260801 was assigned to Ravi Kumar.', '2026-08-10T09:12:00.000Z', 0, 'blue');
}

seedIfEmpty();

db.prepare(`INSERT OR IGNORE INTO users (id, tenant_id, role, name, email, password_hash, mobile, city)
  SELECT 'user-staff', tenant_id, 'finance_staff', 'Nisha Verma', 'staff@aaryafinance.test', password_hash, '+91 98450 11113', 'Bengaluru'
  FROM users WHERE id = 'user-admin'`).run();

const saveNormalizedMobile = db.prepare('UPDATE users SET mobile_e164 = ? WHERE id = ?');
for (const user of db.prepare('SELECT id, mobile FROM users WHERE mobile IS NOT NULL AND mobile_e164 IS NULL').all()) {
  saveNormalizedMobile.run(normalizeIndiaMobile(user.mobile), user.id);
}

// Preserve existing demo cases while enforcing authority approval for every new assignment.
db.prepare(`UPDATE recovery_cases SET
  authority_document_file_name = COALESCE(authority_document_file_name, 'legacy-authority-record'),
  authority_document_original_name = COALESCE(authority_document_original_name, 'Legacy authority record'),
  authority_document_mime_type = COALESCE(authority_document_mime_type, 'application/octet-stream'),
  authority_document_byte_size = COALESCE(authority_document_byte_size, 0),
  authority_document_sha256 = COALESCE(authority_document_sha256, 'legacy'),
  authority_approved_at = COALESCE(authority_approved_at, updated_at),
  authority_approved_by_user_id = COALESCE(authority_approved_by_user_id, 'user-admin')
  WHERE status <> 'Imported' AND authority_approved_at IS NULL AND tenant_id = 'tenant-aarya'`).run();

// Older demo records may have a pass ID but predate the immutable pass ledger.
const legacyReleasePasses = db.prepare(`SELECT * FROM recovery_cases WHERE release_pass_id IS NOT NULL`).all();
const saveLegacyPass = db.prepare(`INSERT OR IGNORE INTO release_passes (id, tenant_id, case_id, issued_by_user_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model, custody_id, payment_reference) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)`);
for (const legacyCase of legacyReleasePasses) {
  saveLegacyPass.run(legacyCase.release_pass_id, legacyCase.tenant_id, legacyCase.id, `LEGACY-${legacyCase.id.slice(-4)}`, legacyCase.updated_at, legacyCase.borrower_name, legacyCase.borrower_mobile, legacyCase.registration, legacyCase.make_model, legacyCase.custody_id);
}

db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('001-initial-tenant-workflow', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('002-evidence-and-durable-settings', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('003-structured-inspection-checklist', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('004-release-pass-ledger', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('005-finance-approval-gates', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('006-otp-sessions', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('007-monthly-import-snapshots', now());
db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('008-assignment-notes', now());

function backupFileName() {
  return `seizer-${new Date().toISOString().slice(0, 10)}.db`;
}

export function backupDatabase({ force = false } = {}) {
  const backupPath = join(backupDirectory, force ? `seizer-${new Date().toISOString().replace(/[:.]/g, '-')}.db` : backupFileName());
  if (existsSync(backupPath)) return backupPath;
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return backupPath;
}

// One consistent SQLite snapshot per day protects local development data from accidental changes.
backupDatabase();

export function isoNow() { return now(); }

export function addAudit({ tenantId, caseId = null, actorUserId, action, detail }) {
  db.prepare('INSERT INTO audit_events (tenant_id, case_id, actor_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(tenantId, caseId, actorUserId, action, detail, now());
}

export function addNotification({ tenantId, recipientUserId = null, title, detail, tone }) {
  const id = `n-${crypto.randomUUID()}`;
  db.prepare('INSERT INTO notifications (id, tenant_id, recipient_user_id, title, detail, created_at, read, tone) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(id, tenantId, recipientUserId, title, detail, now(), tone);
}
