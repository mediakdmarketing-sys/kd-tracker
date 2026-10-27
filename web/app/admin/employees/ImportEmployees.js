'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { parseCsv, employeesFromCsv, toCsv, downloadText } from '@/lib/csv';

const TEMPLATE = toCsv(
  ['Name', 'Email', 'Department', 'Employee code'],
  [['Asha Raman', 'asha@yourcompany.com', 'Support', 'E-101']]
);

/**
 * Upload a CSV of employees. The file is read in the browser, checked, shown as a preview and only
 * then sent. The reply lists who was added (with their temporary passwords, shown once) and who
 * was skipped and why.
 */
export default function ImportEmployees() {
  const router = useRouter();
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function close() {
    setOpen(false);
    setParsed(null);
    setFileName('');
    setError(null);
    setResult(null);
    if (input.current) input.current.value = '';
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    setError(null);
    setParsed(null);
    if (!file) return;
    setFileName(file.name);
    try {
      setParsed(employeesFromCsv(parseCsv(await file.text())));
    } catch {
      setError('That file could not be read as a CSV.');
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const rows = parsed.rows.map(({ line, ...rest }) => rest);
      const res = await post('/api/admin/employees/import', { rows });
      setResult(res);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadLogins() {
    downloadText(
      'new-employee-logins.csv',
      toCsv(
        ['Name', 'Email', 'Department', 'Temporary password'],
        result.created.map((c) => [c.name, c.email, c.department || '', c.temporaryPassword])
      )
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Import CSV
      </button>
    );
  }

  return (
    <div className="card" style={{ flexBasis: '100%' }}>
      <div className="card-head">
        <h2>Import employees</h2>
        <button type="button" className="btn" onClick={close} disabled={busy}>
          {result ? 'Done' : 'Cancel'}
        </button>
      </div>
      <div className="card-pad">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}

        {!result && (
          <>
            <p className="faint" style={{ marginTop: 0, fontSize: 13 }}>
              A CSV with a header row: <strong>Name</strong> and <strong>Email</strong> are required;{' '}
              <strong>Department</strong>, <strong>Employee code</strong> and <strong>Time zone</strong> are
              optional. Everyone is added as an employee with a temporary password, and departments that do
              not exist yet are created.{' '}
              <a
                href="#template"
                onClick={(e) => {
                  e.preventDefault();
                  downloadText('employees-template.csv', TEMPLATE);
                }}
              >
                Download a template
              </a>
            </p>

            <input ref={input} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />

            {parsed && (
              <div style={{ marginTop: 14 }}>
                {parsed.problems.length > 0 && (
                  <div className="notice notice-warn" style={{ marginBottom: 10 }}>
                    {parsed.problems.slice(0, 6).map((p) => (
                      <div key={p}>{p}</div>
                    ))}
                    {parsed.problems.length > 6 && <div>…and {parsed.problems.length - 6} more.</div>}
                  </div>
                )}
                {parsed.rows.length > 0 && (
                  <>
                    <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Department</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.slice(0, 8).map((r) => (
                            <tr key={r.line}>
                              <td>{r.name}</td>
                              <td>{r.email}</td>
                              <td>{r.department || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="faint" style={{ fontSize: 12 }}>
                      {fileName}: {parsed.rows.length} ready to import
                      {parsed.rows.length > 8 ? ' (first 8 shown)' : ''}. At most 500 per file.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={submit}
                      disabled={busy || parsed.rows.length > 500}
                    >
                      {busy ? 'Importing…' : `Import ${parsed.rows.length} employees`}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {result && (
          <>
            <div className="notice notice-info" style={{ marginBottom: 14 }}>
              <strong>{result.created.length} added</strong>
              {result.skipped.length > 0 && `, ${result.skipped.length} skipped`}.
              {result.created.length > 0 && (
                <>
                  {' '}
                  <strong>Download the login details now</strong>: the temporary passwords are shown only here
                  and cannot be read again. Each person chooses their own at first sign-in.
                </>
              )}
            </div>
            {result.created.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={downloadLogins}>
                Download login details (CSV)
              </button>
            )}
            {result.skipped.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Email</th>
                      <th>Why it was skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={`${s.line}-${s.email}`}>
                        <td className="num">{s.line}</td>
                        <td>{s.email}</td>
                        <td>{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
