'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/client';

/**
 * One person's month: days present, total hours, full / half days and the hours on short days, for a
 * month picked here, with the same figures as a CSV. Worked out from closed shifts.
 */
export default function MonthlySummaryCard({ employeeId, initialMonth }) {
  const [month, setMonth] = useState(initialMonth);
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return undefined;
    let stopped = false;
    setError(null);
    call(`/api/admin/employees/${employeeId}/monthly?month=${month}`)
      .then((data) => { if (!stopped) setRow(data); })
      .catch((err) => { if (!stopped) { setRow(null); setError(err.message); } });
    return () => { stopped = true; };
  }, [employeeId, month]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Monthly summary</h2>
          <span className="faint" style={{ fontSize: 12 }}>From closed shifts. Pick a month.</span>
        </div>
        <div className="inline" style={{ gap: 8 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
            style={{ width: 'auto' }}
          />
          <a
            className="btn"
            href={`/bff/api/admin/employees/${employeeId}/monthly?month=${month}&format=csv`}
            download
            title="Download this month as a CSV file"
          >
            ↓ Export CSV
          </a>
        </div>
      </div>

      {error ? (
        <div className="notice notice-danger" style={{ margin: 14 }} role="alert">{error}</div>
      ) : !row ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Email</th>
                <th>Department</th>
                <th>Month</th>
                <th>Days Present</th>
                <th>Total Hours</th>
                <th>Full Days</th>
                <th>Half Days</th>
                <th title="Hours worked on days shorter than a half day">Other Hours</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{row.name}</td>
                <td className="muted">{row.email}</td>
                <td className="muted">{row.department || '—'}</td>
                <td className="num">{row.month}</td>
                <td className="num">{row.daysPresent}</td>
                <td className="num">{row.totalHours.toFixed(2)}</td>
                <td className="num">{row.fullDays}</td>
                <td className="num">{row.halfDays}</td>
                <td className="num">{row.otherHours ? row.otherHours.toFixed(2) : <span className="faint">—</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
