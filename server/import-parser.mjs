import { normalizeIndiaMobile } from './otp-service.mjs';
import { readSheet } from 'read-excel-file/node';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ',') { row.push(value); value = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows.filter((item) => item.some((cell) => String(cell).trim()));
}

export async function parseImportFile({ originalName, buffer }) {
  const name = originalName.toLowerCase();
  if (name.endsWith('.csv')) return parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  if (name.endsWith('.xlsx')) return readSheet(buffer);
  throw new Error('Upload a CSV or XLSX file.');
}

const aliases = {
  accountNumber: ['accountnumber', 'loannumber', 'loanaccount'],
  borrowerName: ['customername', 'borrowername', 'name'],
  borrowerMobile: ['mobilenumber', 'mobile', 'borrowermobile', 'phone'],
  borrowerAddress: ['address', 'borroweraddress', 'customeraddress'],
  registration: ['registrationnumber', 'vehiclenumber', 'registration'],
  makeModel: ['makemodel', 'vehiclemodel', 'model'],
  vehicleType: ['vehicletype', 'type'],
  chassis: ['chassisnumber', 'chassis'],
  branch: ['branch', 'branchname'],
  pendingAmount: ['pendingamount', 'amountpending', 'outstandingamount'],
  overdueDays: ['overduedays', 'daysoverdue'],
};

function headerKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cell(row, headerIndexes, field) {
  const index = aliases[field].map((name) => headerIndexes.get(name)).find((value) => value !== undefined);
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

function moneyToPaise(value) {
  const normalized = value.replace(/[₹,\s]/g, '');
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : null;
}

function vehicleType(value) {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, '');
  if (['2w', '2wheeler', 'twowheeler'].includes(normalized)) return '2-wheeler';
  if (['4w', '4wheeler', 'fourwheeler'].includes(normalized)) return '4-wheeler';
  return null;
}

export function normalizeImportRows(rows) {
  if (rows.length < 2) return { valid: [], errors: [{ row: 1, message: 'The file must contain a header and at least one data row.' }] };
  const headerIndexes = new Map(rows[0].map((value, index) => [headerKey(value), index]));
  const valid = [];
  const errors = [];

  rows.slice(1).forEach((row, index) => {
    if (!row.some((value) => String(value ?? '').trim())) return;
    const sourceRow = index + 2;
    const accountNumber = cell(row, headerIndexes, 'accountNumber');
    const borrowerName = cell(row, headerIndexes, 'borrowerName');
    const borrowerAddress = cell(row, headerIndexes, 'borrowerAddress');
    const registration = cell(row, headerIndexes, 'registration').toUpperCase().replace(/\s+/g, ' ');
    const makeModel = cell(row, headerIndexes, 'makeModel');
    const type = vehicleType(cell(row, headerIndexes, 'vehicleType'));
    const pendingAmountPaise = moneyToPaise(cell(row, headerIndexes, 'pendingAmount'));
    const overdueValue = cell(row, headerIndexes, 'overdueDays');
    const overdueDays = /^\d+$/.test(overdueValue) ? Number(overdueValue) : null;
    let borrowerMobile = '';
    try { borrowerMobile = normalizeIndiaMobile(cell(row, headerIndexes, 'borrowerMobile')); } catch { /* reported below */ }

    const missing = [];
    if (!accountNumber) missing.push('account number');
    if (!borrowerName) missing.push('customer name');
    if (!borrowerMobile) missing.push('mobile');
    if (!borrowerAddress) missing.push('address');
    if (!registration) missing.push('registration');
    if (!makeModel) missing.push('make/model');
    if (!type) missing.push('vehicle type');
    if (pendingAmountPaise === null) missing.push('pending amount');
    if (overdueDays === null) missing.push('overdue days');
    if (missing.length) { errors.push({ row: sourceRow, message: `Check ${missing.join(', ')}.` }); return; }

    valid.push({
      accountNumber,
      borrowerName,
      borrowerMobile,
      borrowerAddress,
      registration,
      makeModel,
      vehicleType: type,
      chassis: cell(row, headerIndexes, 'chassis').toUpperCase(),
      branch: cell(row, headerIndexes, 'branch'),
      pendingAmountPaise,
      overdueDays,
      sourceRow,
    });
  });

  return { valid, errors };
}
