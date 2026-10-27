// Small CSV helpers for the employee import and the "login details" download. Handles quoted
// cells, doubled quotes and line breaks inside quotes; no dependency needed for this.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Saves text as a file in the browser. */
export function downloadText(filename, text) {
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Header names people actually type, mapped to the fields the server takes.
const COLUMN_ALIASES = {
  name: ['name', 'full name', 'employee', 'employee name'],
  email: ['email', 'work email', 'e-mail', 'email address', 'username'],
  department: ['department', 'dept', 'team'],
  employeeCode: ['employee code', 'code', 'employee id', 'emp id', 'id'],
  timezone: ['time zone', 'timezone', 'tz'],
};

/** Turns parsed CSV rows (first row = headers) into {rows, problems}. */
export function employeesFromCsv(parsed) {
  if (parsed.length < 2) return { rows: [], problems: ['The file has no rows under the header.'] };

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) index[field] = i;
  }
  const problems = [];
  if (index.name === undefined) problems.push('No "Name" column found.');
  if (index.email === undefined) problems.push('No "Email" column found.');
  if (problems.length) return { rows: [], problems };

  const rows = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const cells = parsed[i];
    const row = { line: i + 1 };
    for (const [field, at] of Object.entries(index)) {
      const value = (cells[at] || '').trim();
      if (value) row[field] = value;
    }
    if (!row.name || !row.email) {
      problems.push(`Line ${row.line}: needs both a name and an email.`);
      continue;
    }
    rows.push(row);
  }
  return { rows, problems };
}
