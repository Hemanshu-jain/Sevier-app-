import { normalizeIndiaMobile } from './otp-service.mjs';
import { queryOne, tx } from './mysql.mjs';

// Development-only demo data. Gated by the caller (never runs in production) and
// idempotent (only seeds an empty database). OTP login uses mobile_e164, dev code 123456.
export async function seedDevData(pool) {
  const existing = await queryOne(pool, 'SELECT COUNT(*) AS count FROM users');
  if (existing.count > 0) return;

  const users = [
    ['user-admin', 'tenant-aarya', 'super_admin', 'Arun Mehta', 'admin@aaryafinance.test', '+91 98450 11111', 'Bengaluru'],
    ['user-manager', 'tenant-aarya', 'finance_manager', 'Divya Rao', 'manager@aaryafinance.test', '+91 98450 11112', 'Bengaluru'],
    ['user-staff', 'tenant-aarya', 'finance_staff', 'Nisha Verma', 'staff@aaryafinance.test', '+91 98450 11113', 'Bengaluru'],
    ['agent-1', 'tenant-aarya', 'agent', 'Ravi Kumar', 'ravi@field.test', '+91 98451 22014', 'Bengaluru'],
    ['agent-2', 'tenant-aarya', 'agent', 'Ayesha Shaikh', 'ayesha@field.test', '+91 99018 45107', 'Bengaluru'],
    ['agent-3', 'tenant-aarya', 'agent', 'Naveen Reddy', 'naveen@field.test', '+91 97319 00682', 'Mysuru'],
    ['sample-admin', 'tenant-sample', 'super_admin', 'Sample Finserv Admin', 'admin@samplefinserv.test', '+91 90000 10000', 'Chennai'],
  ];

  // [id, account, borrower, mobile, address, reg, makeModel, chassis, type, branch, pending, overdue, status, agent, hasAuthority]
  const cases = [
    ['RC-260801', 'LN-801449', 'Meera Iyer', '+91 98450 21736', '4th Cross, HSR Layout, Bengaluru', 'KA 01 MQ 4281', '2023 Honda Activa 6G', 'ME4JF90A6P8A04421', '2-wheeler', 'HSR Layout', 38400, 97, 'assigned', 'agent-1', true],
    ['RC-260792', 'LN-801356', 'Shashank Rao', '+91 99000 88921', 'JP Nagar Phase 7, Bengaluru', 'KA 05 JJ 6810', '2021 TVS Apache RTR 160', 'MD634KE47M2B59138', '2-wheeler', 'JP Nagar', 24600, 88, 'unable_to_recover', 'agent-1', true],
    ['RC-260787', 'LN-801309', 'Kavya Menon', '+91 98442 36157', 'Indiranagar 100 Ft Road, Bengaluru', 'KA 03 PN 4125', '2020 Hyundai Venue SX', 'MALPC813LLM207452', '4-wheeler', 'Indiranagar', 121900, 113, 'payment_pending', 'agent-3', true],
    ['RC-260780', 'LN-801250', 'Rohit Kulkarni', '+91 97408 05513', 'Yelahanka New Town, Bengaluru', 'KA 04 SB 7789', '2021 Royal Enfield Classic 350', 'ME3U3S5C2M1D80128', '2-wheeler', 'Yelahanka', 42750, 64, 'imported', null, false],
    ['RC-260774', 'LN-801184', 'Farah Ali', '+91 99867 42018', 'Kengeri Satellite Town, Bengaluru', 'KA 41 Q 1146', '2022 Suzuki Access 125', 'MB8DP11A3P8F92174', '2-wheeler', 'Kengeri', 31200, 73, 'custody_review', 'agent-2', true],
  ];

  const custody = [
    ['CT-260078', 'RC-260787', 'Sri Lakshmi Parking, Yeshwanthpur', '2026-08-05T18:25:00.000Z', 350, '2026-08-05T18:41:00.000Z', 'Naveen Reddy', 14, '2026-08-06T09:00:00.000Z'],
    ['CT-260077', 'RC-260774', 'Sri Lakshmi Parking, Yeshwanthpur', '2026-08-05T15:18:00.000Z', 350, '2026-08-05T15:32:00.000Z', 'Ayesha Shaikh', 14, null],
  ];

  const now = '2026-08-10T09:00:00.000Z';
  await tx(pool, async (conn) => {
    await conn.query("INSERT INTO tenants (id, name) VALUES ('tenant-aarya', 'Aarya Finance Pvt. Ltd.'), ('tenant-sample', 'Sample Finserv Ltd.')");
    for (const [id, tenantId, role, name, email, mobile, city] of users) {
      await conn.query(
        `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164)
         VALUES (?, ?, ?, ?, ?, 'otp-only', ?, ?, 1, ?)`,
        [id, tenantId, role, name, email, mobile, city, normalizeIndiaMobile(mobile)]);
    }
    for (const [id, account, borrower, mobile, address, reg, makeModel, chassis, type, branch, pending, overdue, status, agent, hasAuthority] of cases) {
      const custodyId = custody.find((row) => row[1] === id)?.[0] ?? null;
      await conn.query(
        `INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address, registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, assigned_agent_user_id, assigned_at, updated_at, custody_id, payment_cleared,
           authority_document_original_name, authority_approved_at, authority_approved_by_user_id)
         VALUES (?, 'tenant-aarya', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, account, borrower, mobile, address, reg, makeModel, chassis, type, branch, pending, overdue, status, agent, agent ? now : null, now, custodyId,
         hasAuthority ? 'Legacy authority record' : null, hasAuthority ? now : null, hasAuthority ? 'user-admin' : null]);
    }
    for (const [id, caseId, yard, arrival, rate, createdAt, agentName, checklist, reviewedAt] of custody) {
      await conn.query(
        `INSERT INTO custody_records (id, tenant_id, case_id, yard_name, arrival_time, parking_rate, created_at, agent_name, checklist_count, finance_reviewed_at, finance_reviewed_by_user_id)
         VALUES (?, 'tenant-aarya', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, caseId, yard, arrival, rate, createdAt, agentName, checklist, reviewedAt, reviewedAt ? 'user-manager' : null]);
    }
    await conn.query(
      `INSERT INTO notifications (id, tenant_id, recipient_user_id, case_id, title, detail, created_at, tone) VALUES
        ('n-1', 'tenant-aarya', NULL, 'RC-260774', 'Custody report submitted', 'RC-260774 was submitted by Ayesha Shaikh and is awaiting your review.', '2026-08-10T11:42:00.000Z', 'green'),
        ('n-2', 'tenant-aarya', NULL, 'RC-260792', 'Recovery attempt could not be completed', 'RC-260792 was marked vehicle not found with a field note.', '2026-08-10T10:25:00.000Z', 'amber'),
        ('n-3', 'tenant-aarya', 'agent-1', 'RC-260801', 'New case assigned', 'RC-260801 was assigned to Ravi Kumar.', '2026-08-10T09:12:00.000Z', 'blue')`);
  });
  console.log('Seeded development demo data (dev OTP code is 123456).');
}
