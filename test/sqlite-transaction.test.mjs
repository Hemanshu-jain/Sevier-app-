import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runTransaction } from '../server/sqlite-transaction.mjs';

test('rolls back every write when a transaction action fails', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE values_to_keep (value TEXT NOT NULL)');

  assert.throws(() => runTransaction(database, () => {
    database.prepare('INSERT INTO values_to_keep (value) VALUES (?)').run('discard me');
    throw new Error('stop');
  }), /stop/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM values_to_keep').get().count, 0);
  database.close();
});

test('commits all writes when a transaction action succeeds', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE values_to_keep (value TEXT NOT NULL)');

  const result = runTransaction(database, () => {
    database.prepare('INSERT INTO values_to_keep (value) VALUES (?)').run('keep me');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.equal(database.prepare('SELECT value FROM values_to_keep').get().value, 'keep me');
  database.close();
});
