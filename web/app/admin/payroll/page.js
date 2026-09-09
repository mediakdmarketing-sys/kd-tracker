import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import GeneratePayroll from './GeneratePayroll';
import { currentMonth, dateLabel } from '@/lib/format';

export const metadata = { title: 'Payroll · KD Tracker' };

export default async function PayrollPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const month = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : currentMonth(user.timezone);
  const result = await api(`/api/payroll?month=${month}`);

  const totalHours = result.rows.reduce((sum, r) => sum + r.totalHours, 0);
  const unsynced = result.rows.filter((r) => !r.syncedToPayroll).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payroll</h1>
          <p>Monthly worked hours, ready for the payroll provider.</p>
        </div>
        <div className="btn-row">
          <GeneratePayroll month={month} hasRows={result.rows.length > 0} />
          {result.rows.length ? (
            <a className="btn btn-primary" href={`/bff/api/payroll/export?month=${month}`}>
              Export CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[{ name: 'month', label: 'Month', type: 'month', defaultValue: month }]}
            />
          </Suspense>
        </div>

        {result.rows.length === 0 ? (
          <div className="card">
            <div className="empty">
              Nothing generated for {month} yet. Use <strong>Generate</strong> to aggregate closed
              shifts into a payroll summary. Re-running it later is safe — it overwrites rather
              than duplicating.
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-stats">
              <div className="stat">
                <div className="label">Employees</div>
                <div className="value">{result.rows.length}</div>
              </div>
              <div className="stat">
                <div className="label">Total hours</div>
                <div className="value">{totalHours.toFixed(2)}</div>
              </div>
              <div className="stat">
                <div className="label">Not yet synced</div>
                <div className="value" style={unsynced ? { color: 'var(--warn)' } : undefined}>
                  {unsynced}
                </div>
                <div className="sub">export, then mark as synced</div>
              </div>
              <div className="stat">
                <div className="label">Generated</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {dateLabel(result.rows[0].generatedOn?.slice(0, 10))}
                </div>
              </div>
            </div>

            <div className="card">
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
                      <th>Synced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link href={`/admin/employees/${row.employeeId}`}>{row.name}</Link>
                        </td>
                        <td className="muted">{row.department || '—'}</td>
                        <td className="num">{row.daysPresent}</td>
                        <td className="num">{row.workedFormatted}</td>
                        <td className="num">{row.totalHours.toFixed(2)}</td>
                        <td className="num muted">{row.breakFormatted}</td>
                        <td className="num muted">{row.idleFormatted}</td>
                        <td className="num">
                          {row.daysFlagged ? (
                            <span className="pill pill-flag">{row.daysFlagged}</span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${row.syncedToPayroll ? 'pill-working' : 'pill-none'}`}>
                            {row.syncedToPayroll ? 'Synced' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="notice notice-info">
              Idle time is {result.rows[0]?.idleDeducted
                ? <><strong>deducted</strong> from paid hours in this summary (<code>PAYROLL_DEDUCT_IDLE=true</code>).</>
                : <><strong>not deducted</strong> from paid hours — it is reported for visibility only. Set <code>PAYROLL_DEDUCT_IDLE=true</code> in the server environment and regenerate to deduct it.</>
              }
            </div>
          </>
        )}
      </div>
    </>
  );
}
