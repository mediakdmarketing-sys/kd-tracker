'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { readTable } from '@/lib/csv';

/**
 * Upload many rows from a spreadsheet saved as CSV. The file is read in the browser, shown back
 * as a preview, and sent as one request: the server saves all of it or none of it, and names the
 * rows that are wrong so the sheet can be fixed and uploaded again.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.endpoint       POST target, receives { rows }
 * @param {Array<{key: string, label: string, aliases?: string[], required?: boolean}>} props.columns
 * @param {(row: object) => object} [props.prepare]  turns a parsed row into what the API expects
 * @param {string} props.example        sample CSV text, offered as a template download
 * @param {string} props.templateName
 * @param {string} props.hint
 * @param {(result: object) => string} props.successText
 */
export default function BulkUpload({ title, endpoint, columns, prepare = (r) => r, example, templateName, hint, successText }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const [done, setDone] = useState(null);

  const parsed = text.trim() ? readTable(text, columns) : null;
  const rows = parsed ? parsed.rows : [];

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    setError(null);
    setRowErrors([]);
    setDone(null);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([example], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload() {
    setBusy(true);
    setError(null);
    setRowErrors([]);
    try {
      const result = await post(endpoint, { rows: rows.map(prepare) });
      setDone(successText(result));
      setText('');
      setFileName('');
      router.refresh();
    } catch (err) {
      setError(err.message);
      // Zod problems name a field path ("rows.2.dailyRate"), the service names a data row.
      setRowErrors(
        Array.isArray(err.details)
          ? err.details.map((d) => {
              const m = /^rows\.(\d+)\.?(.*)$/.exec(d.field || '');
              return m ? { row: Number(m[1]) + 1, message: `${m[2] || 'value'}: ${d.message}` } : { row: d.row, message: d.message };
            })
          : []
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Upload a spreadsheet
      </button>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Close
        </button>
      </div>
      <div className="card-pad">
        <p className="muted" style={{ marginTop: 0 }}>{hint}</p>

        <div className="inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn" onClick={downloadTemplate}>
            Download template
          </button>
          <label className="btn btn-info" style={{ cursor: 'pointer' }}>
            Choose a .csv file
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} disabled={busy} />
          </label>
          {fileName ? <span className="faint">{fileName}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="bulk-text">Or paste the rows here (first line is the header)</label>
          <textarea
            id="bulk-text"
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
            }}
            placeholder={example}
            disabled={busy}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>

        {parsed && parsed.missing.length > 0 && (
          <div className="notice notice-danger" style={{ marginTop: 12 }} role="alert">
            The header is missing: <strong>{parsed.missing.join(', ')}</strong>. Use the template to see the columns.
          </div>
        )}

        {error && (
          <div className="notice notice-danger" style={{ marginTop: 12 }} role="alert">
            {error}
            {rowErrors.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {rowErrors.slice(0, 50).map((r, i) => (
                  <li key={i}>Row {r.row}: {r.message}</li>
                ))}
                {rowErrors.length > 50 && <li>…and {rowErrors.length - 50} more</li>}
              </ul>
            )}
          </div>
        )}

        {done && (
          <div className="notice notice-info" style={{ marginTop: 12 }} role="status">
            {done}
          </div>
        )}

        {parsed && parsed.missing.length === 0 && rows.length > 0 && (
          <>
            <div className="table-wrap" style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="num faint">{i + 1}</td>
                      {columns.map((c) => <td key={c.key}>{r[c.key] ?? <span className="faint">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && <p className="faint">Showing the first 100 of {rows.length} rows.</p>}
            <div className="inline" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={upload} disabled={busy}>
                {busy ? 'Uploading…' : `Upload ${rows.length} row${rows.length === 1 ? '' : 's'}`}
              </button>
              <span className="faint">Saved all together or not at all.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
