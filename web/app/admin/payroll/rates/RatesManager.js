'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call, post, patch } from '@/lib/client';
import { moneyValue } from '@/lib/csv';
import { money } from '@/lib/money';
import { DEFAULT_TZ } from '@/lib/format';
import BulkUpload from '@/components/BulkUpload';

const COLUMNS = [
  { key: 'email', label: 'Email', required: true },
  { key: 'dailyRate', label: 'Daily rate (USD)', aliases: ['daily_rate', 'rate', 'amount', 'per day'], required: true },
  { key: 'effectiveFrom', label: 'Effective from', aliases: ['effective_from', 'from', 'start date', 'date'], required: true },
  { key: 'note', label: 'Note', aliases: ['reason', 'remarks'] },
];

const EXAMPLE = 'email,daily_rate,effective_from,note\nkarthik.s@kdmarketing.in,45.00,2026-11-01,Starting rate\nsneha.iyer@kdmarketing.in,52.50,2026-11-01,Annual increment\n';

// "Today" on the company clock, as YYYY-MM-DD, to pre-fill the start date.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(new Date());

function RateForm({ initial, onSave, onCancel, busy, submitLabel }) {
  const [rate, setRate] = useState(initial.dailyRate ?? '');
  const [from, setFrom] = useState(initial.effectiveFrom ?? today());
  const [note, setNote] = useState(initial.note ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ dailyRate: Number(rate), effectiveFrom: from, note: note || undefined });
      }}
    >
      <div className="filters" style={{ marginBottom: 10 }}>
        <div className="field">
          <label>Daily rate (USD)</label>
          <input type="number" step="0.01" min="0.01" required value={rate} onChange={(e) => setRate(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label>Effective from</label>
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Annual increment" disabled={busy} />
        </div>
      </div>
      <div className="inline">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}

function Panel({ employee, onChanged }) {
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setHistory((await call(`/api/payroll/rates/${employee.employeeId}`)).rates);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.employeeId]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
      {error && <div className="notice notice-danger" style={{ marginBottom: 10 }} role="alert">{error}</div>}

      <strong>Set a new rate or increment</strong>
      <div style={{ marginTop: 8, marginBottom: 14 }}>
        <RateForm
          initial={{}}
          busy={busy}
          submitLabel="Save rate"
          onSave={(v) => run(() => post('/api/payroll/rates', { employeeId: employee.employeeId, ...v }))}
        />
      </div>

      <strong>History</strong>
      {history === null ? (
        <p className="faint">Loading…</p>
      ) : history.length === 0 ? (
        <p className="faint">No rate has been set for this employee yet.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr><th>From</th><th>Daily rate</th><th>Note</th><th /></tr>
            </thead>
            <tbody>
              {history.map((r) =>
                editing === r.id ? (
                  <tr key={r.id}>
                    <td colSpan={4}>
                      <RateForm
                        initial={r}
                        busy={busy}
                        submitLabel="Update"
                        onCancel={() => setEditing(null)}
                        onSave={(v) => run(() => patch(`/api/payroll/rates/${r.id}`, v))}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td>{r.effectiveFrom}</td>
                    <td className="num">{money(r.dailyRate)}</td>
                    <td className="muted">{r.note || '—'}</td>
                    <td><button type="button" className="btn" onClick={() => setEditing(r.id)} disabled={busy}>Edit</button></td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RatesManager({ rows }) {
  const router = useRouter();
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('');

  const shown = rows.filter((r) =>
    `${r.name} ${r.email} ${r.department || ''}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <>
      <BulkUpload
        title="Upload pay rates"
        endpoint="/api/payroll/rates/bulk"
        columns={COLUMNS}
        prepare={(r) => ({ ...r, dailyRate: moneyValue(r.dailyRate) })}
        example={EXAMPLE}
        templateName="pay-rates-template.csv"
        hint="One row per employee and start date. A row for a date that already has a rate replaces it. Dates are YYYY-MM-DD."
        successText={(r) => `Saved: ${r.created} new, ${r.updated} replaced.`}
      />

      <div className="card">
        <div className="card-head">
          <h2>Employees</h2>
          <input
            type="search"
            placeholder="Search name, email, department"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 260 }}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Rate now</th>
                <th>Since</th>
                <th>Next change</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.employeeId}>
                  <tr>
                    <td>
                      {r.name}
                      <div className="faint" style={{ fontSize: 12 }}>{r.email}</div>
                    </td>
                    <td className="muted">{r.department || '—'}</td>
                    <td className="num">
                      {r.currentRate === null ? <span className="pill pill-flag">No rate</span> : money(r.currentRate)}
                    </td>
                    <td className="muted">{r.currentFrom || '—'}</td>
                    <td className="muted">
                      {r.upcomingRate !== null ? `${money(r.upcomingRate)} from ${r.upcomingFrom}` : '—'}
                    </td>
                    <td>
                      <button type="button" className="btn" onClick={() => setOpenId(openId === r.employeeId ? null : r.employeeId)}>
                        {openId === r.employeeId ? 'Close' : r.currentRate === null ? 'Set rate' : 'Raise / history'}
                      </button>
                    </td>
                  </tr>
                  {openId === r.employeeId && (
                    <tr>
                      <td colSpan={6}>
                        <Panel employee={r} onChanged={() => router.refresh()} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="empty">No employees match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
