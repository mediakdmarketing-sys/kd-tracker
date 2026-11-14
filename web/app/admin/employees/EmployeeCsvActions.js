'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

/**
 * Two buttons: "Export CSV" and "Import CSV".
 *
 * Export: direct <a> download via the BFF — no JS needed after the click.
 * Import: reads a CSV file in the browser, parses it, POSTs JSON to the backend,
 *         shows a per-row result summary, then refreshes the employee list.
 *
 * The CSV template matches the export format exactly, so HR can:
 *   1. Export the current list,
 *   2. Add rows for new hires,
 *   3. Import the edited file.
 *
 * Required columns (case-insensitive header): Name, Email
 * Optional: Employee Code, Department, Role, Timezone, Birthday (YYYY-MM-DD)
 */

// Maps from whatever header the CSV has to the field name the API expects.
const HEADER_MAP = {
  'name':                   'name',
  'full name':              'name',
  'email':                  'email',
  'work email':             'email',
  'employee code':          'employeeCode',
  'code':                   'employeeCode',
  'department':             'department',
  'dept':                   'department',
  'role':                   'role',
  'timezone':               'timezone',
  'time zone':              'timezone',
  'birthday (yyyy-mm-dd)':  'birthday',
  'birthday':               'birthday',
  'date of birth':          'birthday',
};

function parseCsv(text) {
  // Split on \r\n or \n, ignore empty trailing lines.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('The file has no data rows.');

  // Simple RFC 4180 parser — handles quoted fields with embedded commas and newlines.
  function parseLine(line) {
    const fields = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let field = '';
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { field += line[i++]; }
        }
        if (line[i] === ',') i++;
        fields.push(field);
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) { fields.push(line.slice(i)); break; }
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
    return fields;
  }

  // Strip Excel BOM if present.
  const rawHeader = lines[0].replace(/^\uFEFF/, '');
  const headers = parseLine(rawHeader).map((h) => h.trim().toLowerCase());

  // Validate required columns.
  const nameIdx  = headers.findIndex((h) => HEADER_MAP[h] === 'name');
  const emailIdx = headers.findIndex((h) => HEADER_MAP[h] === 'email');
  if (nameIdx === -1 || emailIdx === -1) {
    throw new Error('CSV must have a "Name" column and an "Email" column.');
  }

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = parseLine(lines[r]);
    if (cols.every((c) => !c.trim())) continue; // skip blank rows

    const obj = {};
    headers.forEach((h, i) => {
      const field = HEADER_MAP[h];
      if (field && cols[i] !== undefined) obj[field] = cols[i].trim();
    });
    if (obj.name && obj.email) rows.push(obj);
  }
  if (rows.length === 0) throw new Error('No valid rows found (every row needs Name and Email).');
  return rows;
}

export default function EmployeeCsvActions() {
  const router = useRouter();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { created, skipped, errors }
  const [importError, setImportError] = useState(null);

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected after a fix.
    e.target.value = '';
    setResult(null);
    setImportError(null);
    setBusy(true);

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await post('/api/admin/employees/import', { rows });
      setResult(res);
      if (res.created > 0) router.refresh();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
      {/* Export: browser downloads directly from the BFF endpoint */}
      <a
        href="/bff/api/admin/employees/export"
        download="employees.csv"
        className="btn"
      >
        ↓ Export CSV
      </a>

      {/* Import trigger */}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? 'Importing…' : '↑ Import CSV'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={handleImport}
      />

      {/* Result summary */}
      {result && (
        <div
          className={`notice ${result.errors.length ? 'notice-warn' : 'notice-info'}`}
          style={{ width: '100%', marginTop: 4 }}
        >
          <strong>
            {result.created} created{result.skipped > 0 ? `, ${result.skipped} skipped (email already exists)` : ''}
            {result.errors.length > 0 ? `, ${result.errors.length} error${result.errors.length > 1 ? 's' : ''}` : ''}
          </strong>
          {result.errors.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 16, fontSize: 12 }}>
              {result.errors.map((e) => (
                <li key={e.row}>Row {e.row} ({e.email}): {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Parse / network error */}
      {importError && (
        <div className="notice notice-danger" style={{ width: '100%', marginTop: 4 }}>
          {importError}
        </div>
      )}

      {/* Template hint */}
      <p className="faint" style={{ width: '100%', margin: 0, fontSize: 11 }}>
        Import CSV columns: <strong>Name, Email</strong> (required) · Employee Code, Department, Role, Timezone, Birthday (optional).
        Export the current list to get a ready-to-use template.
      </p>
    </div>
  );
}
