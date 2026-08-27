import { backupDatabase } from './db.mjs';

console.log(`Database backup created: ${backupDatabase({ force: true })}`);
