'use client';

import { useState } from 'react';
import { call } from '@/lib/client';

/**
 * The end of a contract: download everything the company owns, then (once suspended, by typing its
 * exact name) remove it permanently. Deleting cannot be undone.
 */
export default function DangerCard({ company }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const suspended = company.status === 'suspended';

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await call(`/api/super/companies/${company.id}`, { method: 'DELETE', body: { confirmName: typed } });
      window.location.href = '/super';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger, #b42318)' }}>
      <div className="card-head">
        <h2>End of contract</h2>
      </div>
      <div className="card-pad">
        {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}

        <p style={{ marginTop: 0 }}>
          <strong>1. Export.</strong> Download everything this company owns (people, attendance, leave, payroll, audit
          trail, and the list of capture files) as one file to hand over.
        </p>
        <a className="btn btn-primary" href={`/bff/api/super/companies/${company.id}/export`}>
          Download export (JSON)
        </a>
        <p className="faint" style={{ fontSize: 12 }}>
          Screenshots, recordings and proof files themselves are not in the file (they are listed by name and size).
        </p>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />

        <p style={{ marginTop: 0 }}>
          <strong>2. Delete permanently.</strong> Removes every person, record and file of this company. This cannot be undone.
        </p>
        {!suspended ? (
          <div className="notice notice-warn">Suspend the company first (in Features above), then come back here.</div>
        ) : (
          <>
            <div className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
              <label htmlFor="dg-name">Type the company name to confirm: <strong>{company.name}</strong></label>
              <input id="dg-name" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" />
            </div>
            <button
              type="button"
              className="btn"
              style={{ borderColor: 'var(--danger, #b42318)', color: 'var(--danger, #b42318)' }}
              onClick={remove}
              disabled={busy || typed.trim() !== company.name}
            >
              {busy ? 'Deleting…' : 'Delete company permanently'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
