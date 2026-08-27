import test from 'node:test';
import assert from 'node:assert/strict';
import { casesToCsv } from '../server/report-export.mjs';

test('case CSV escapes spreadsheet formulas, commas, quotes, and line breaks', () => {
  const csv = casesToCsv([{
    id: 'RC-1', account_number: '=1+1', borrower_name: 'Rao, "Anita"', borrower_mobile: '+919876543210',
    registration: 'MH 12 AB 1234', make_model: 'Tata\nNexon', vehicle_type: '4-wheeler', branch: 'Pune',
    pending_amount: 84500, overdue_days: 62, status: 'Imported', agent_name: null, updated_at: '2026-08-28T10:00:00.000Z',
  }]);

  assert.ok(csv.startsWith('\uFEFF"Case ID","Loan account"'));
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"Rao, ""Anita"""/);
  assert.match(csv, /"'\+919876543210"/);
  assert.match(csv, /"Tata\nNexon"/);
});
