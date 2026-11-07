'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call, put, del } from '@/lib/client';

/**
 * Where this employee's pay goes. The account number is hidden (****1234) until HR asks to see it,
 * and every look is written to the audit log by the server.
 *
 * @param {{ employee: { id: string, name: string }, initial: object, unavailable?: string|null }} props
 *   initial      what the server returned for GET /employees/:id/bank (masked)
 *   unavailable  a message when bank details are switched off on the server (no key set)
 */
export default function BankDetailsCard({ employee, initial, unavailable = null }) {
  const router = useRouter();
  const [shown, setShown] = useState(null); // the full details, once HR has asked
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bank: '', branch: '', accountName: '', accountNumber: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const has = Boolean(initial?.hasDetails);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    await run(async () => setShown(await call(`/api/admin/employees/${employee.id}/bank?reveal=1`)));
  }

  async function startEdit() {
    setError(null);
    // Editing starts from the current values, so a typo fix does not mean typing it all again.
    // That needs the full record, so it is a "reveal" and is audited like one.
    if (has && !shown) {
      const ok = await run(async () => {
        const full = await call(`/api/admin/employees/${employee.id}/bank?reveal=1`);
        setShown(full);
        setForm({ bank: full.bank, branch: full.branch, accountName: full.accountName, accountNumber: full.accountNumber });
      });
      if (!ok) return;
    } else if (shown) {
      setForm({ bank: shown.bank, branch: shown.branch, accountName: shown.accountName, accountNumber: shown.accountNumber });
    } else {
      setForm({ bank: '', branch: '', accountName: employee.name || '', accountNumber: '' });
    }
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    const ok = await run(() => put(`/api/admin/employees/${employee.id}/bank`, form));
    if (ok) {
      setEditing(false);
      setShown(null);
      router.refresh();
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the bank details of ${employee.name}? They will have to be entered again before the next payment file.`)) return;
    if (await run(() => del(`/api/admin/employees/${employee.id}/bank`))) {
      setShown(null);
      router.refresh();
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card">
      <div className="card-head">
        <h2>Bank details</h2>
        <span className="faint">Where this person is paid. HR only; every look is recorded.</span>
      </div>
      <div className="card-pad">
        {unavailable && <div className="notice notice-warn" style={{ marginBottom: 12 }}>{unavailable}</div>}
        {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}

        {!editing && !unavailable && (
          <>
            {has ? (
              <dl className="kv-grid" style={{ margin: '0 0 14px' }}>
                <div><div className="faint">Bank</div><strong>{(shown || initial).bank}</strong></div>
                <div><div className="faint">Branch</div>{(shown || initial).branch || '—'}</div>
                <div><div className="faint">Account name</div>{(shown || initial).accountName}</div>
                <div>
                  <div className="faint">Account number</div>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{shown ? shown.accountNumber : initial.accountNumberMasked}</strong>
                </div>
              </dl>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                No bank details yet. Without them {employee.name} is flagged &ldquo;NO BANK DETAILS&rdquo; on the payment file.
              </p>
            )}
            <div className="btn-row">
              {has && !shown && <button type="button" className="btn" onClick={reveal} disabled={busy}>{busy ? 'Opening…' : 'Show account number'}</button>}
              {has && shown && <button type="button" className="btn" onClick={() => setShown(null)}>Hide</button>}
              <button type="button" className="btn btn-primary" onClick={startEdit} disabled={busy}>{has ? 'Edit' : 'Add bank details'}</button>
              {has && <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>Remove</button>}
            </div>
            {has && initial.updatedAt && (
              <p className="faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
                Last changed {new Date(initial.updatedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
              </p>
            )}
          </>
        )}

        {editing && (
          <form onSubmit={save}>
            <div className="filters" style={{ marginBottom: 12 }}>
              <div className="field">
                <label htmlFor="bd-bank">Bank</label>
                <input id="bd-bank" required maxLength={100} value={form.bank} onChange={set('bank')} placeholder="e.g. Bank of Ceylon" disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="bd-branch">Branch</label>
                <input id="bd-branch" maxLength={100} value={form.branch} onChange={set('branch')} placeholder="e.g. Jaffna Main" disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="bd-name">Name on the account</label>
                <input id="bd-name" required maxLength={100} value={form.accountName} onChange={set('accountName')} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="bd-number">Account number</label>
                <input id="bd-number" required inputMode="numeric" autoComplete="off" maxLength={40} value={form.accountNumber} onChange={set('accountNumber')} disabled={busy} />
              </div>
            </div>
            <p className="faint" style={{ marginTop: 0, fontSize: 12 }}>
              The name must match the name the bank has, or the bank may reject the payment. Spaces in the account number are removed.
            </p>
            <div className="inline">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
