import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import GeneratePayroll from './GeneratePayroll';
import { currentMonth, dateLabel } from '@/lib/format';
import { money } from '@/lib/money';
import { EmailAllPayslips, EmailPayslipButton, EmailStatus } from '@/components/EmailPayslip';

export const metadata = { title: 'Payroll · WorkBuddy' };

export default async function PayrollPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const month = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : currentMonth(user.timezone);
  const [result, mail] = await Promise.all([
    api(`/api/payroll?month=${month}`),
    api(`/api/payroll/payslips/status?month=${month}`),
  ]);
  const mailByEmployee = Object.fromEntries(mail.rows.map((r) => [r.employeeId, r]));
  const pendingMail = mail.rows.filter((r) => r.status === 'queued' || r.status === 'sending').length;

  const totalHours = result.rows.reduce((sum, r) => sum + r.totalHours, 0);
  const totalNet = result.rows.reduce((sum, r) => sum + r.netPay, 0);
  const missingRates = result.rows.filter((r) => r.rateMissingDays > 0);
  const unsynced = result.rows.filter((r) => !r.syncedToPayroll).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payroll</h1>
          <p>Monthly worked hours, ready for the payroll provider.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/admin/payroll/rates">Pay rates</Link>
          <Link className="btn" href={`/admin/payroll/bonuses?month=${month}`}>Bonuses</Link>
          <GeneratePayroll month={month} hasRows={result.rows.length > 0} />
          {result.rows.length ? (
            <EmailAllPayslips
              month={month}
              count={result.rows.length}
              emailConfigured={mail.emailConfigured}
              pending={pendingMail}
              alreadySent={mail.rows.filter((r) => r.status === 'sent').length}
            />
          ) : null}
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

        {missingRates.length > 0 && (
          <div className="notice notice-warn">
            <strong>{missingRates.length}</strong> {missingRates.length === 1 ? 'employee has' : 'employees have'} worked
            days with no pay rate, so those days pay nothing:{' '}
            {missingRates.map((r) => r.name).join(', ')}. Set their rates on the{' '}
            <Link href="/admin/payroll/rates">Pay rates</Link> page, then <strong>Regenerate</strong>.
          </div>
        )}

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
                <div className="label">Net pay</div>
                <div className="value">{money(totalNet)}</div>
                <div className="sub">full / half days, hours, + bonuses</div>
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
                      <th>Full</th>
                      <th>Half</th>
                      <th>Other hrs</th>
                      <th>Base pay</th>
                      <th>Bonus</th>
                      <th>Net pay</th>
                      <th>Idle</th>
                      <th>Flagged</th>
                      <th>Synced</th>
                      <th>Emailed</th>
                      <th />
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
                        <td className="num">{row.fullDays}</td>
                        <td className="num">{row.halfDays}</td>
                        <td className="num" title={row.otherDays ? `Over ${row.otherDays} day${row.otherDays === 1 ? '' : 's'} that were neither full nor half` : undefined}>
                          {row.otherHours ? row.otherHours.toFixed(2) : <span className="faint">—</span>}
                          {row.rateMissingDays ? (
                            <span className="pill pill-flag" title="Worked days with no pay rate" style={{ marginLeft: 6 }}>
                              +{row.rateMissingDays} unpaid
                            </span>
                          ) : null}
                        </td>
                        <td className="num">{money(row.basePay)}</td>
                        <td className="num">{row.bonusTotal ? money(row.bonusTotal) : <span className="faint">—</span>}</td>
                        <td className="num"><strong>{money(row.netPay)}</strong></td>
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
                        <td>
                          <EmailStatus {...(mailByEmployee[row.employeeId] || {})} />
                        </td>
                        <td>
                          <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <Link className="btn" href={`/admin/payroll/payslip/${row.employeeId}?month=${month}`}>
                              Payslip
                            </Link>
                            <EmailPayslipButton
                              month={month}
                              employeeId={row.employeeId}
                              status={mailByEmployee[row.employeeId]?.status}
                            />
                          </div>
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
