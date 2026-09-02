import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required for MySQL.');
  // multipleStatements lets a whole migration file run in one call.
  // decimalNumbers returns DECIMAL columns as JS numbers instead of strings.
  return mysql.createPool({ uri: url, multipleStatements: true, decimalNumbers: true });
}

// Data access. `executor` is the pool or a tx connection — both expose .query,
// so ported helpers take it the way the old SQLite helpers took `database`.
// query() returns rows for SELECT, or the ResultSetHeader (.affectedRows/.insertId) for writes.
export async function query(executor, sql, params = []) {
  const [result] = await executor.query(sql, params);
  return result;
}

export async function queryOne(executor, sql, params = []) {
  const [rows] = await executor.query(sql, params);
  return rows[0] ?? null;
}

// Runs fn inside one transaction on a dedicated connection; rolls back on throw.
export async function tx(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Applies ordered server/migrations/*.sql not yet recorded. Returns the ids it ran.
export async function migrate(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(191) PRIMARY KEY, applied_at DATETIME NOT NULL)');
    // ponytail: GET_LOCK is connection-scoped, so acquire/release on the same conn.
    const [[lock]] = await conn.query("SELECT GET_LOCK('handoff_migrate', 10) AS ok");
    if (!lock.ok) throw new Error('Could not acquire the migration lock.');
    try {
      const [applied] = await conn.query('SELECT id FROM schema_migrations');
      const done = new Set(applied.map((row) => row.id));
      const ran = [];
      for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
        const id = file.replace(/\.sql$/, '');
        if (done.has(id)) continue;
        await conn.query(readFileSync(join(migrationsDir, file), 'utf8'));
        await conn.query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, NOW())', [id]);
        ran.push(id);
      }
      return ran;
    } finally {
      await conn.query("SELECT RELEASE_LOCK('handoff_migrate')");
    }
  } finally {
    conn.release();
  }
}
