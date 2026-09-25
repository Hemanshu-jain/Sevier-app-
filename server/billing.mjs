import { randomUUID } from 'node:crypto';
import { query, queryOne, tx } from './mysql.mjs';

// The only module that moves wallet money. Schema lives in migrations/011_billing.sql.
// Rules: prices come from platform_settings; charges are paid strictly oldest-first (billing_charges.id);
// an item whose charge can't be paid stays billing_locked until a confirmed top-up settles it.

export const TOPUP_AMOUNTS_PAISE = Object.freeze([200000, 500000, 1000000]);

const PRICE_COLUMN = { case_import: 'vehicle_row_paise', case_manual: 'vehicle_row_paise', case_api: 'vehicle_row_paise', verification: 'verification_fee_paise', api_key: 'api_key_fee_paise' };
const LOCK_TABLE = { case_import: 'recovery_cases', case_manual: 'recovery_cases', case_api: 'recovery_cases', verification: 'verification_requests' };

export async function platformSettings(executor) {
  return queryOne(executor, 'SELECT * FROM platform_settings WHERE id = 1');
}

// ponytail: one wallet row lock per tenant serialises all billing for that tenant; fine at this scale.
async function lockWallet(conn, tenantId, now) {
  await query(conn, 'INSERT IGNORE INTO wallets (tenant_id, balance_paise, updated_at) VALUES (?, 0, ?)', [tenantId, now]);
  const wallet = await queryOne(conn, 'SELECT balance_paise FROM wallets WHERE tenant_id = ? FOR UPDATE', [tenantId]);
  return Number(wallet.balance_paise);
}

async function recordPayment(conn, { tenantId, chargeId, amount, balanceAfter, now }) {
  await query(conn, "UPDATE billing_charges SET status = 'paid', paid_at = ? WHERE id = ?", [now, chargeId]);
  await query(conn, "INSERT INTO wallet_transactions (tenant_id, kind, amount_paise, balance_after_paise, charge_id, created_at) VALUES (?, 'charge', ?, ?, ?, ?)",
    [tenantId, -amount, balanceAfter, chargeId, now]);
}

// Runs inside the caller's transaction so a charge commits or rolls back with the item it bills.
// items: [{ itemType, itemId, batchId?, lockable }] in the order they should be paid.
export async function chargeItems(conn, { tenantId, items, now = new Date().toISOString() }) {
  const result = { paid: 0, pending: 0, amountPaidPaise: 0, amountDuePaise: 0 };
  if (!items.length) return result;
  const settings = await platformSettings(conn);
  let balance = await lockWallet(conn, tenantId, now);
  // Strict FIFO: once anything is waiting, newer charges queue behind it.
  let blocked = Boolean(await queryOne(conn, "SELECT 1 FROM billing_charges WHERE tenant_id = ? AND status = 'pending' LIMIT 1", [tenantId]));
  for (const item of items) {
    const amount = Number(settings[PRICE_COLUMN[item.itemType]]);
    const inserted = await query(conn,
      "INSERT INTO billing_charges (tenant_id, item_type, item_id, import_batch_id, amount_paise, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [tenantId, item.itemType, item.itemId, item.batchId ?? null, amount, now]);
    if (!blocked && balance >= amount) {
      balance -= amount;
      await recordPayment(conn, { tenantId, chargeId: inserted.insertId, amount, balanceAfter: balance, now });
      result.paid += 1; result.amountPaidPaise += amount;
    } else {
      blocked = true;
      result.pending += 1; result.amountDuePaise += amount;
      if (item.lockable && LOCK_TABLE[item.itemType]) await query(conn, `UPDATE ${LOCK_TABLE[item.itemType]} SET billing_locked = 1 WHERE id = ? AND tenant_id = ?`, [item.itemId, tenantId]);
    }
  }
  await query(conn, 'UPDATE wallets SET balance_paise = ?, updated_at = ? WHERE tenant_id = ?', [balance, now, tenantId]);
  return result;
}

// Pays pending charges oldest-first while the balance allows, then unlocks items with nothing left owing.
export async function settlePending(conn, { tenantId, now = new Date().toISOString() }) {
  let balance = await lockWallet(conn, tenantId, now);
  const pending = await query(conn, "SELECT * FROM billing_charges WHERE tenant_id = ? AND status = 'pending' ORDER BY id FOR UPDATE", [tenantId]);
  const settled = [];
  for (const charge of pending) {
    const amount = Number(charge.amount_paise);
    if (balance < amount) break;
    balance -= amount;
    await recordPayment(conn, { tenantId, chargeId: charge.id, amount, balanceAfter: balance, now });
    settled.push(charge);
  }
  for (const charge of settled) {
    const stillOwing = await queryOne(conn, "SELECT 1 FROM billing_charges WHERE tenant_id = ? AND item_id = ? AND status = 'pending' LIMIT 1", [tenantId, charge.item_id]);
    if (!stillOwing && LOCK_TABLE[charge.item_type]) await query(conn, `UPDATE ${LOCK_TABLE[charge.item_type]} SET billing_locked = 0 WHERE id = ? AND tenant_id = ?`, [charge.item_id, tenantId]);
  }
  await query(conn, 'UPDATE wallets SET balance_paise = ?, updated_at = ? WHERE tenant_id = ?', [balance, now, tenantId]);
  return { settled: settled.length, balancePaise: balance };
}

export async function requestTopup({ database, tenantId, userId, amountPaise, reference, now = new Date().toISOString() }) {
  const amount = Number(amountPaise);
  if (!TOPUP_AMOUNTS_PAISE.includes(amount)) throw new Error('Choose a recharge of ₹2,000, ₹5,000 or ₹10,000.');
  const cleanReference = String(reference || '').trim();
  if (cleanReference.length < 4 || cleanReference.length > 100) throw new Error('Enter the UPI or bank payment reference (4 to 100 characters).');
  const id = `tp-${randomUUID()}`;
  await query(database,
    "INSERT INTO topup_requests (id, tenant_id, amount_paise, reference, status, requested_by_user_id, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    [id, tenantId, amount, cleanReference, userId, now]);
  return { id, amountPaise: amount, reference: cleanReference, status: 'pending', createdAt: now };
}

// Confirming credits the wallet and settles locked items in the same transaction.
export async function decideTopup({ database, topupId, adminUserId, approve, now = new Date().toISOString() }) {
  return tx(database, async (conn) => {
    const topup = await queryOne(conn, 'SELECT * FROM topup_requests WHERE id = ? FOR UPDATE', [topupId]);
    if (!topup) throw new Error('Top-up request not found.');
    if (topup.status !== 'pending') throw new Error('This top-up request was already decided.');
    await query(conn, 'UPDATE topup_requests SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?', [approve ? 'confirmed' : 'rejected', adminUserId, now, topup.id]);
    if (!approve) return { tenantId: topup.tenant_id, status: 'rejected', settled: 0 };
    const amount = Number(topup.amount_paise);
    const balance = await lockWallet(conn, topup.tenant_id, now) + amount;
    await query(conn, 'UPDATE wallets SET balance_paise = ?, updated_at = ? WHERE tenant_id = ?', [balance, now, topup.tenant_id]);
    await query(conn, "INSERT INTO wallet_transactions (tenant_id, kind, amount_paise, balance_after_paise, topup_id, created_at) VALUES (?, 'topup', ?, ?, ?, ?)",
      [topup.tenant_id, amount, balance, topup.id, now]);
    const { settled, balancePaise } = await settlePending(conn, { tenantId: topup.tenant_id, now });
    return { tenantId: topup.tenant_id, status: 'confirmed', settled, balancePaise };
  });
}

export async function billingSummary(database, tenantId) {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const wallet = await queryOne(database, 'SELECT balance_paise FROM wallets WHERE tenant_id = ?', [tenantId]);
  const totals = await queryOne(database, `SELECT
      COALESCE(SUM(status = 'pending'), 0) AS pendingCount,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_paise END), 0) AS duePaise,
      COALESCE(SUM(created_at >= ?), 0) AS monthCount,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN amount_paise END), 0) AS monthPaise,
      COUNT(*) AS allCount,
      COALESCE(SUM(amount_paise), 0) AS allPaise
    FROM billing_charges WHERE tenant_id = ?`, [monthStart.toISOString(), monthStart.toISOString(), tenantId]);
  const imports = await query(database, `SELECT b.id, b.file_name, b.snapshot_month, b.created_at, COUNT(c.id) AS rows_charged,
      COALESCE(SUM(c.amount_paise), 0) AS amount_paise, COALESCE(SUM(c.status = 'pending'), 0) AS pending_rows
    FROM import_batches b LEFT JOIN billing_charges c ON c.import_batch_id = b.id
    WHERE b.tenant_id = ? GROUP BY b.id, b.file_name, b.snapshot_month, b.created_at ORDER BY b.created_at DESC LIMIT 50`, [tenantId]);
  const charges = await query(database, 'SELECT * FROM billing_charges WHERE tenant_id = ? ORDER BY id DESC LIMIT 100', [tenantId]);
  const topups = await query(database, 'SELECT * FROM topup_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20', [tenantId]);
  const settings = await platformSettings(database);
  return {
    balancePaise: Number(wallet?.balance_paise ?? 0),
    duePaise: Number(totals.duePaise),
    lockedCount: Number(totals.pendingCount),
    month: { count: Number(totals.monthCount), amountPaise: Number(totals.monthPaise) },
    allTime: { count: Number(totals.allCount), amountPaise: Number(totals.allPaise) },
    prices: { vehicleRowPaise: Number(settings.vehicle_row_paise), verificationFeePaise: Number(settings.verification_fee_paise) },
    paymentInstructions: settings.payment_instructions ?? '',
    topupAmountsPaise: TOPUP_AMOUNTS_PAISE,
    imports: imports.map((row) => ({ id: row.id, fileName: row.file_name, snapshotMonth: row.snapshot_month, createdAt: row.created_at, rowsCharged: Number(row.rows_charged), amountPaise: Number(row.amount_paise), pendingRows: Number(row.pending_rows) })),
    charges: charges.map((row) => ({ id: Number(row.id), itemType: row.item_type, itemId: row.item_id, amountPaise: Number(row.amount_paise), status: row.status, createdAt: row.created_at, paidAt: row.paid_at ?? undefined })),
    topups: topups.map(mapTopup),
  };
}

export function mapTopup(row) {
  return { id: row.id, tenantId: row.tenant_id, tenantName: row.tenant_name ?? undefined, amountPaise: Number(row.amount_paise), reference: row.reference, status: row.status, requestedBy: row.requested_by_name ?? undefined, createdAt: row.created_at, decidedAt: row.decided_at ?? undefined };
}
