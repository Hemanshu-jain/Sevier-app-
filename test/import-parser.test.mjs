import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImportRows, parseCsv, parseImportFile } from '../server/import-parser.mjs';

test('CSV parser preserves quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('Name,Address,Note\r\nMeera,"4th Cross, Bengaluru","Said ""call later"""'), [
    ['Name', 'Address', 'Note'],
    ['Meera', '4th Cross, Bengaluru', 'Said "call later"'],
  ]);
});

test('monthly import normalizes the required borrower, vehicle, and loan fields', () => {
  const result = normalizeImportRows([
    ['Account Number', 'Customer Name', 'Mobile Number', 'Address', 'Registration Number', 'Make / Model', 'Vehicle Type', 'Chassis Number', 'Branch', 'Pending Amount', 'Overdue Days'],
    ['LN-1001', 'Meera Iyer', '98765 43210', 'Bengaluru', 'ka 01 mq 4281', 'Honda Activa 6G', '2W', 'ME4JF90A6P8A04421', 'HSR', '38,400.50', '97'],
  ]);

  assert.deepEqual(result, {
    valid: [{
      accountNumber: 'LN-1001', borrowerName: 'Meera Iyer', borrowerMobile: '919876543210', borrowerAddress: 'Bengaluru',
      registration: 'KA 01 MQ 4281', makeModel: 'Honda Activa 6G', vehicleType: '2-wheeler', chassis: 'ME4JF90A6P8A04421',
      branch: 'HSR', pendingAmountPaise: 3840050, overdueDays: 97, sourceRow: 2,
    }],
    errors: [],
  });
});

test('monthly import reports invalid rows without dropping valid rows', () => {
  const result = normalizeImportRows([
    ['Account Number', 'Customer Name', 'Mobile Number', 'Address', 'Registration Number', 'Make / Model', 'Vehicle Type', 'Pending Amount', 'Overdue Days'],
    ['LN-1', 'Valid Person', '9876543210', 'Bengaluru', 'KA 01 AA 1000', 'Honda Activa', '2-wheeler', '1000', '30'],
    ['', 'Missing Account', '123', '', '', '', 'truck', '-1', 'no'],
  ]);

  assert.equal(result.valid.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 3);
  assert.match(result.errors[0].message, /account number|mobile|registration|amount|overdue/i);
});

test('import files accept CSV and reject unsupported formats', async () => {
  assert.deepEqual(await parseImportFile({ originalName: 'accounts.csv', buffer: Buffer.from('A,B\n1,2') }), [['A', 'B'], ['1', '2']]);
  await assert.rejects(() => parseImportFile({ originalName: 'accounts.xls', buffer: Buffer.from('old excel') }), /CSV or XLSX/);
});
