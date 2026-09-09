import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import { duration, hours, daysAgoDate, todayIn, dateLabel } from '@/lib/format';

export const metadata = { title: 'Reports · KD Tracker' };

export default async function ReportsPage({ searchParams }) {
  const params = await searchParams;

  const from       = params.from       || daysAgoDate(30);
  const to         = params.to         || todayIn();
  const department = params.department || '';

  const reportQuery = new URLSearchParams({ from, to, ...(department ? { department } : {}) });

  // Three independent fetches — all parallel.
  // GET /api/admin/departments returns only a string[] of department names (~50 bytes)
  // instead of 200 full employee objects (~20 KB) that were previously fetched just to
  // extract unique department values for the filter dropdown.
  const [user, departments, report] = await Promise.all([
    requireUser({ adminOnly: true }),
    api('/api/admin/departments'),
    api(`/api/admin/reports?${reportQuery}`),
  ]);

  const totals = report.rows.reduce(
    (acc, r) => ({
      worked:  acc.worked  + r.workedSeconds,
      breaks:  acc.breaks  + r.breakSeconds,
      idle:    acc.idle    + r.idleSeconds,
      days:    acc.days    + r.daysPresent,
      flagged: acc.flagged + r.flaggedDays,
    }),
    { worked: 0, breaks: 0, idle: 0, days: 0, flagged: 0 }
  );

  const csvHref = `/bff/api/admin/reports?${new URLSearchParams({
    from,
    to,
    ...(department ? { department } : {}),
    format: 'csv',
  })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>
            {dateLabel(from)} — {dateLabel(to)}
            {department ? ` · ${department}` : ''}
          </p>
        </div>
        <a className="btn btn-primary" href={csvHref}>
          Export CSV
        </a>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                {
                  name: 'department',
                  label: 'Department',
                  type: 'select',
                  options: [
                    { value: '', label: 'All departments' },
                    ...departments.map((d) => ({ value: d, label: d })),
                  ],
                },
              ]}
            />
          </Suspense>
        </div>

        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Total worked</div>
            <div className="value">{hours(totals.worked)}</div>
            <div className="sub">hours across {report.rows.length} people</div>
          </div>
          <div className="stat">
            <div className="label">Shifts</div>
            <div className="value">{totals.days}</div>
          </div>
          <div className="stat">
            <div className="label">Break time</div>
            <div className="value">{duration(totals.breaks)}</div>
          </div>
          <div className="stat">
            <div className="label">Idle time</div>
            <div className="value">{duration(totals.idle)}</div>
            <div className="sub">recorded, not deducted from pay</div>
          </div>
          <div className="stat">
            <div className="label">Flagged days</div>
            <div className="value" style={totals.flagged ? { color: 'var(--danger)' } : undefined}>
              {totals.flagged}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>By employee</h2>
            <span className="faint">Exports include a row per day</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Days</th>
                  <th>Worked</th>
                  <th>Hours</th>
                  <th>Break</th>
                  <th>Idle</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">No attendance in this range.</div>
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        <Link href={`/admin/employees/${row.employeeId}`}>{row.name}</Link>
                        <div className="faint">{row.email}</div>
                      </td>
                      <td className="muted">{row.department || '—'}</td>
                      <td className="num">{row.daysPresent}</td>
                      <td className="num">{row.workedFormatted}</td>
                      <td className="num">{row.workedHours}</td>
                      <td className="num">{duration(row.breakSeconds)}</td>
                      <td className="num muted">{duration(row.idleSeconds)}</td>
                      <td className="num">
                        {row.flaggedDays ? (
                          <span className="pill pill-flag">{row.flaggedDays}</span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
