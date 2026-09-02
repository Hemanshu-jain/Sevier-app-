// Obsolete. The old SQLite layer has been replaced by MySQL:
//   - schema/triggers → server/migrations/001_initial.sql (run by server/mysql.mjs migrate())
//   - connection/query/transaction helpers → server/mysql.mjs
//   - demo data → server/seed-dev.mjs
// ponytail: kept only because file deletion is blocked here; safe to `git rm` later.
export {};
