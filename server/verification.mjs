import { randomUUID } from 'node:crypto';
import { query, queryOne, tx } from './mysql.mjs';
import { chargeItems, platformSettings } from './billing.mjs';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { notSuspendedBy } from './agent-management.mjs';

// House / location verification. Schema: migrations/014_verification.sql.
export const VERIFICATION_PHOTOS = { min: 2, max: 4 };
const RESULTS = new Set(['verified', 'not_verified']);

function clean(value, max) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max + 1);
}

export function validateVerificationInput(values) {
  const input = {
    reference: clean(values.reference, 100),
    customerName: clean(values.customerName, 255),
    address: String(values.address ?? '').trim(),
    landmark: clean(values.landmark, 255),
    city: clean(values.city, 191),
    pincode: clean(values.pincode, 10),
    instructions: String(values.instructions ?? '').trim(),
  };
  if (!input.reference || input.reference.length > 100) return { error: 'Enter the application / loan reference (up to 100 characters).' };
  if (input.customerName.length < 2 || input.customerName.length > 255) return { error: "Enter the customer's full name." };
  try { input.customerMobile = normalizeIndiaMobile(values.customerMobile); } catch { return { error: 'Enter a valid Indian mobile number for the customer.' }; }
  if (input.address.length < 5 || input.address.length > 1000) return { error: 'Enter the full residential address (5 to 1,000 characters).' };
  if (input.landmark.length > 255) return { error: 'Keep the landmark within 255 characters.' };
  if (input.city.length < 2 || input.city.length > 191) return { error: 'Enter the city.' };
  if (input.pincode && !/^\d{6}$/.test(input.pincode)) return { error: 'The PIN code must be 6 digits.' };
  if (input.instructions.length > 2000) return { error: 'Keep instructions within 2,000 characters.' };
  return { input };
}

export function validateVerificationSubmission({ result, note, photoCount }) {
  if (!RESULTS.has(result)) return 'Choose whether the location was verified.';
  const text = String(note ?? '').trim();
  if (!text || text.length > 2000) return 'A factual note up to 2,000 characters is required.';
  if (photoCount < VERIFICATION_PHOTOS.min || photoCount > VERIFICATION_PHOTOS.max) return `Take ${VERIFICATION_PHOTOS.min} to ${VERIFICATION_PHOTOS.max} photos of the location.`;
  return null;
}

// The platform fee is charged at creation and never refunded. An unpaid fee locks the request until recharge.
export async function createVerification({ database, tenantId, userId, values, now = new Date().toISOString() }) {
  const { input, error } = validateVerificationInput(values);
  if (error) throw new Error(error);
  const id = `VR-${now.slice(2, 7).replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
  return tx(database, async (conn) => {
    const fee = Number((await platformSettings(conn)).verification_fee_paise);
    await query(conn,
      `INSERT INTO verification_requests (id, tenant_id, reference, customer_name, customer_mobile, address, landmark, city, pincode, instructions, status, platform_fee_paise, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [id, tenantId, input.reference, input.customerName, input.customerMobile, input.address, input.landmark || null, input.city, input.pincode || null, input.instructions || null, fee, userId, now, now]);
    const billing = await chargeItems(conn, { tenantId, items: [{ itemType: 'verification', itemId: id, lockable: true }], now });
    return { id, billing };
  });
}

export async function assignVerification({ database, tenantId, userId, requestId, agentId, now = new Date().toISOString() }) {
  const request = await queryOne(database, 'SELECT * FROM verification_requests WHERE id = ? AND tenant_id = ?', [requestId, tenantId]);
  if (!request) throw new Error('Verification request not found.');
  if (request.billing_locked) throw new Error('This record is locked until your wallet is recharged.');
  if (!['open', 'assigned'].includes(request.status)) throw new Error('Only an open or assigned request can be (re)assigned.');
  const agent = await queryOne(database,
    "SELECT users.id, users.rate_verification_paise FROM agent_memberships m JOIN users ON users.id = m.agent_user_id WHERE m.tenant_id = ? AND m.agent_user_id = ? AND m.active = 1 AND users.active = 1 AND users.role = 'agent'",
    [tenantId, agentId]);
  if (!agent) throw new Error('Choose an active agent from your roster.');
  await query(database, "UPDATE verification_requests SET status = 'assigned', assigned_agent_user_id = ?, assigned_by_user_id = ?, assigned_at = ?, agent_rate_paise = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
    [agent.id, userId, now, agent.rate_verification_paise ?? null, now, requestId, tenantId]);
  return { id: requestId, agentId: agent.id, previousAgentId: request.assigned_agent_user_id };
}

export async function cancelVerification({ database, tenantId, requestId, now = new Date().toISOString() }) {
  const result = await query(database, "UPDATE verification_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('open', 'assigned')", [now, requestId, tenantId]);
  if (result.affectedRows !== 1) throw new Error('Only an open or assigned request can be cancelled.');
}

export async function listVerifications(database, user) {
  if (user.role === 'agent') {
    return query(database,
      `SELECT v.*, t.name AS finance_company, fu.name AS finance_contact_name, fu.mobile AS finance_contact_mobile, NULL AS agent_name
         FROM verification_requests v JOIN tenants t ON t.id = v.tenant_id LEFT JOIN users fu ON fu.id = v.assigned_by_user_id
        WHERE v.assigned_agent_user_id = ? AND v.status IN ('assigned', 'submitted') AND ${notSuspendedBy('v.tenant_id')} ORDER BY v.updated_at DESC`, [user.id, user.id]);
  }
  return query(database,
    `SELECT v.*, a.name AS agent_name, r.stars AS agent_stars FROM verification_requests v
       LEFT JOIN users a ON a.id = v.assigned_agent_user_id
       LEFT JOIN agent_ratings r ON r.tenant_id = v.tenant_id AND r.job_type = 'verification' AND r.job_id = v.id AND r.agent_user_id = v.assigned_agent_user_id
      WHERE v.tenant_id = ? ORDER BY v.created_at DESC`, [user.tenantId]);
}

export function mapVerification(row, formatMobile = (value) => value) {
  return {
    id: row.id,
    reference: row.reference,
    customer: { name: row.customer_name, mobile: formatMobile(row.customer_mobile), address: row.address, landmark: row.landmark ?? undefined, city: row.city, pincode: row.pincode ?? undefined },
    instructions: row.instructions ?? undefined,
    status: row.status,
    billingLocked: Boolean(row.billing_locked),
    platformFee: Number(row.platform_fee_paise) / 100,
    agentRate: row.agent_rate_paise === null || row.agent_rate_paise === undefined ? null : Number(row.agent_rate_paise) / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAgentId: row.assigned_agent_user_id ?? undefined,
    assignedAgentName: row.agent_name ?? undefined,
    agentStars: row.agent_stars ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    result: row.result ?? undefined,
    resultNote: row.result_note ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    submittedAt: row.submitted_at ?? undefined,
    finance: row.finance_company ? { company: row.finance_company, contactName: row.finance_contact_name ?? undefined, contactMobile: row.finance_contact_mobile ? formatMobile(row.finance_contact_mobile) : undefined } : undefined,
  };
}
