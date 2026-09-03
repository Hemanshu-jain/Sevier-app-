import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, migrate, query, queryOne, tx } from '../server/mysql.mjs';

// ponytail: skip unless a dev MySQL is configured, so the suite stays green without one.
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run MySQL tests';

test('migrate builds the schema, is idempotent, and declares immutability triggers', { skip }, async () => {
  const pool = createPool();
  try {
    await migrate(pool);
    assert.deepEqual(await migrate(pool), [], 'second migrate should apply nothing');

    const [tables] = await pool.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
    const names = new Set(tables.map((row) => row.t));
    for (const expected of ['tenants', 'users', 'recovery_cases', 'custody_records', 'release_passes', 'field_mutation_receipts', 'audit_events', 'monthly_account_snapshots']) {
      assert.ok(names.has(expected), `missing table ${expected}`);
    }

    const [[trg]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE()");
    assert.equal(trg.n, 10, 'expected 10 immutability triggers');

    await pool.query("INSERT INTO tenants (id, name) VALUES ('t-mysqltest', 'Test Co') ON DUPLICATE KEY UPDATE name = VALUES(name)");
    const [[row]] = await pool.query("SELECT name FROM tenants WHERE id = 't-mysqltest'");
    assert.equal(row.name, 'Test Co');
  } finally {
    await pool.end();
  }
});

test('tx commits on success and rolls back on throw', { skip }, async () => {
  const pool = createPool();
  try {
    await migrate(pool);
    await query(pool, "DELETE FROM tenants WHERE id IN ('t-commit', 't-rollback')");

    await tx(pool, (conn) => query(conn, "INSERT INTO tenants (id, name) VALUES ('t-commit', 'Committed')"));
    assert.equal((await queryOne(pool, "SELECT name FROM tenants WHERE id = 't-commit'")).name, 'Committed');

    await assert.rejects(tx(pool, async (conn) => {
      await query(conn, "INSERT INTO tenants (id, name) VALUES ('t-rollback', 'Gone')");
      throw new Error('boom');
    }), /boom/);
    assert.equal(await queryOne(pool, "SELECT name FROM tenants WHERE id = 't-rollback'"), null);

    await query(pool, "DELETE FROM tenants WHERE id IN ('t-commit', 't-rollback')");
  } finally {
    await pool.end();
  }
});
