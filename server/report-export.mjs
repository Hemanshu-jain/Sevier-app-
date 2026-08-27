const columns = [
  ['Case ID', 'id'], ['Loan account', 'account_number'], ['Customer', 'borrower_name'], ['Mobile', 'borrower_mobile'],
  ['Registration', 'registration'], ['Make / model', 'make_model'], ['Vehicle type', 'vehicle_type'], ['Branch', 'branch'],
  ['Pending amount', 'pending_amount'], ['Overdue days', 'overdue_days'], ['Status', 'status'], ['Assigned agent', 'agent_name'], ['Updated at', 'updated_at'],
];

function cell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function casesToCsv(rows) {
  return `\uFEFF${columns.map(([label]) => cell(label)).join(',')}\r\n${rows.map((row) => columns.map(([, key]) => cell(row[key])).join(',')).join('\r\n')}\r\n`;
}
