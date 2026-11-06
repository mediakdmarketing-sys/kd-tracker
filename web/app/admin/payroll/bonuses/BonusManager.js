'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, del } from '@/lib/client';
import { moneyValue } from '@/lib/csv';
import { money } from '@/lib/money';
import BulkUpload from '@/components/BulkUpload';

const COLUMNS = [
  { key: 'email', label: 'Email', required: true },
  { key: 'month', label: 'Month', aliases: ['payroll month'], required: true },
  { key: 'amount', label: 'Amount (USD)', aliases: ['bonus', 'bonus amount'], required: true },
  { key: 'reason', label: 'Reason', aliases: ['note', 'description'], required: true },
];

export default function BonusManager({ month, rows, employees, locked = false }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const example = `email,month,amount,reason\nkarthik.s@kdmarketing.in,${month},100.00,Festival bonus\nsneha.iyer@kdmarketing.in,${month},50.00,Target achieved\n`;

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/payroll/bonuses', { employeeId, month, amount: Number(amount), reason });
      setAmount('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove the ${money(row.amount)} bonus (${row.reason}) for ${row.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await del(`/api/payroll/bonuses/${row.id}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Add a bonus for {month}</h2></div>
        <div className="card-pad">
          {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
          <form onSubmit={add}>
            <div className="filters" style={{ marginBottom: 12 }}>
              <div className="field">
                <label htmlFor="b-emp">Employee</label>
                <select id="b-emp" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={busy}>
                  <option value="">— Select —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} ({e.email})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-amt">Amount (USD)</label>
                <input id="b-amt" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="b-why">Reason</label>
                <input id="b-why" required maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Festival bonus" disabled={busy} />
              </div>
            </div>
            <div className="inline">
              <button type="submit" className="btn btn-primary" disabled={busy || locked || !employeeId}>{busy ? 'Saving…' : 'Add bonus'}</button>
              <BulkUpload
                title="Upload bonuses"
                endpoint="/api/payroll/bonuses/bulk"
                columns={COLUMNS}
                prepare={(r) => ({ ...r, amount: moneyValue(r.amount) })}
                example={example}
                templateName="bonuses-template.csv"
                hint="One row per bonus. The month says which payroll month it is paid with (YYYY-MM). Several bonuses for one person are fine."
                successText={(r) => `Added ${r.created} bonus${r.created === 1 ? '' : 'es'}.`}
              />
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Bonuses for {month}</h2>
          <span className="muted">Total {money(total)}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Employee</th><th>Reason</th><th>Amount</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<div className="faint" style={{ fontSize: 12 }}>{r.email}</div></td>
                  <td>{r.reason}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td><button type="button" className="btn btn-danger" onClick={() => remove(r)} disabled={busy || locked}>Remove</button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="empty">No bonuses for {month} yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
