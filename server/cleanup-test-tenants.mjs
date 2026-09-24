// One-off: remove data the MySQL test suite wrote into the live database before tests got their
// own TEST_DATABASE_URL. Test tenants = name 'Test t-…' plus the migrate test's 't-mysqltest' ("Test Co").
// Real tenants are never matched; users are only removed if they belong to a test tenant or are
// tenant-less '@test.invalid' test agents.
//
//   node --env-file=.env server/cleanup-test-tenants.mjs            dry run: counts only, changes nothing
//   node --env-file=.env server/cleanup-test-tenants.mjs --delete   asks you to type DELETE first
//
// audit_events, monthly_account_snapshots, release_passes, release_pass_events and field_mutation_receipts
// are immutable (BEFORE DELETE triggers) and are left in place. Cases, batches, users and tenants those rows
// reference cannot be deleted either; they are skipped one by one, never forced, and the test tenants left
// behind are archived (tenants.archived_at) so the platform-admin console hides them.
import { createInterface } from 'node:readline/promises';
import { createPool, query, queryOne, tx } from './mysql.mjs';

const TEST_TENANTS = "SELECT id FROM tenants WHERE name LIKE 'Test t-%' OR (id = 't-mysqltest' AND name = 'Test Co')";
const TEST_USERS = `SELECT id FROM users WHERE tenant_id IN (${TEST_TENANTS}) OR (tenant_id IS NULL AND email LIKE '%@test.invalid')`;

// Mutable, tenant-scoped rows in foreign-key order (children first).
const TENANT_TABLES = [
  ['verification_evidence', `tenant_id IN (${TEST_TENANTS})`],
  ['agent_ratings', `tenant_id IN (${TEST_TENANTS})`],
  ['api_keys', `tenant_id IN (${TEST_TENANTS})`],
  ['topup_requests', `tenant_id IN (${TEST_TENANTS})`],
  ['wallet_transactions', `tenant_id IN (${TEST_TENANTS})`],
  ['billing_charges', `tenant_id IN (${TEST_TENANTS})`],
  ['wallets', `tenant_id IN (${TEST_TENANTS})`],
  ['notification_reads', `notification_id IN (SELECT id FROM notifications WHERE tenant_id IN (${TEST_TENANTS}))`],
  ['notifications', `tenant_id IN (${TEST_TENANTS})`],
  ['agent_group_members', `group_id IN (SELECT id FROM agent_groups WHERE tenant_id IN (${TEST_TENANTS}))`],
  ['agent_groups', `tenant_id IN (${TEST_TENANTS})`],
  ['agent_memberships', `tenant_id IN (${TEST_TENANTS}) OR agent_user_id IN (${TEST_USERS})`],
  ['evidence', `tenant_id IN (${TEST_TENANTS})`],
  ['custody_records', `tenant_id IN (${TEST_TENANTS})`],
  ['case_assignments', `tenant_id IN (${TEST_TENANTS})`],
  ['verification_requests', `tenant_id IN (${TEST_TENANTS})`],
  ['auth_sessions', `user_id IN (${TEST_USERS})`],
];

// Rows that immutable history may still reference: deleted one at a time, skipped on a foreign-key refusal.
const GUARDED_TABLES = [
  ['recovery_cases', `tenant_id IN (${TEST_TENANTS})`],
  ['import_batches', `tenant_id IN (${TEST_TENANTS})`],
  ['users', `id IN (${TEST_USERS})`],
  ['tenants', `id IN (${TEST_TENANTS})`],
];

const IMMUTABLE_TABLES = ['audit_events', 'monthly_account_snapshots', 'release_passes', 'release_pass_events', 'field_mutation_receipts'];
const FK_REFUSED = new Set(['ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED']);

async function count(executor, table, where) {
  return Number((await queryOne(executor, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)).n);
}

async function report(pool) {
  const tenants = await query(pool, `SELECT id FROM tenants WHERE id IN (${TEST_TENANTS})`);
  const real = await query(pool, `SELECT id, name FROM tenants WHERE id NOT IN (${TEST_TENANTS})`);
  console.log(`Database: ${(await queryOne(pool, 'SELECT DATABASE() AS db')).db}`);
  console.log(`Test tenants matched: ${tenants.length}. Real tenants untouched: ${real.map((row) => `${row.id} (${row.name})`).join(', ')}`);
  console.log('\nWill delete:');
  for (const [table, where] of [...TENANT_TABLES, ...GUARDED_TABLES]) console.log(`  ${table.padEnd(24)} ${await count(pool, table, where)}`);
  console.log('\nImmutable history kept (cannot be deleted):');
  for (const table of IMMUTABLE_TABLES) console.log(`  ${table.padEnd(24)} ${await count(pool, table, `tenant_id IN (${TEST_TENANTS})`)}`);
  const money = await queryOne(pool, `SELECT COALESCE(SUM(balance_paise), 0) AS paise FROM wallets WHERE tenant_id IN (${TEST_TENANTS})`);
  console.log(`\nTest wallet money removed from the platform totals: Rs ${(Number(money.paise) / 100).toLocaleString('en-IN')}`);
  return tenants.length;
}

async function deleteGuarded(conn, table, where) {
  const rows = await query(conn, `SELECT id FROM ${table} WHERE ${where}`);
  let deleted = 0;
  for (const { id } of rows) {
    try {
      deleted += (await query(conn, `DELETE FROM ${table} WHERE id = ?`, [id])).affectedRows;
    } catch (error) {
      if (!FK_REFUSED.has(error.code)) throw error;
    }
  }
  return { deleted, kept: rows.length - deleted };
}

async function main() {
  const pool = createPool();
  try {
    const matched = await report(pool);
    if (!process.argv.includes('--delete')) { console.log('\nDry run only. Re-run with --delete to remove these rows.'); return; }
    if (!matched) { console.log('\nNothing to delete.'); return; }
    if (!process.argv.includes('--yes')) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question(`\nType DELETE to remove this test data from the live database: `);
      prompt.close();
      if (answer.trim() !== 'DELETE') { console.log('Cancelled. Nothing was changed.'); return; }
    }
    const results = await tx(pool, async (conn) => {
      const out = [];
      for (const [table, where] of TENANT_TABLES) {
        out.push([table, (await query(conn, `DELETE FROM ${table} WHERE ${where}`)).affectedRows, 0]);
      }
      for (const [table, where] of GUARDED_TABLES) {
        const { deleted, kept } = await deleteGuarded(conn, table, where);
        out.push([table, deleted, kept]);
      }
      // MySQL won't UPDATE a table named in its own subquery, so resolve the leftover ids first.
      const leftovers = (await query(conn, TEST_TENANTS)).map((row) => row.id);
      if (leftovers.length) await query(conn, 'UPDATE tenants SET archived_at = ? WHERE id IN (?) AND archived_at IS NULL', [new Date().toISOString(), leftovers]);
      out.push(['tenants archived', leftovers.length, 0]);
      return out;
    });
    console.log('\nDeleted (kept because immutable history still references them):');
    for (const [table, deleted, kept] of results) console.log(`  ${table.padEnd(24)} ${deleted}${kept ? `  (${kept} kept)` : ''}`);
  } finally {
    await pool.end();
  }
}

await main();
