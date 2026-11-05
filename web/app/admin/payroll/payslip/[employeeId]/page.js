import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { money } from '@/lib/money';
import CompanyLogo from '@/components/CompanyLogo';
import { EmailPayslipButton } from '@/components/EmailPayslip';
import PrintButton from './PrintButton';

export const metadata = { title: 'Payslip · WorkBuddy' };

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function PayslipPage({ params, searchParams }) {
  const { employeeId } = await params;
  const query = await searchParams;
  await requireUser({ adminOnly: true });

  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : null;
  if (!month) {
    return <div className="notice notice-danger">Open a payslip from the Payroll page: the month is missing.</div>;
  }

  let slip;
  let settings;
  let mail;
  try {
    [slip, settings, mail] = await Promise.all([
      api(`/api/payroll/payslip?employeeId=${employeeId}&month=${month}`),
      api('/api/admin/settings'),
      api(`/api/payroll/payslips/status?month=${month}`),
    ]);
  } catch (err) {
    if (err.status === 404) {
      return (
        <div className="stack">
          <div className="notice notice-warn">{err.message}</div>
          <div><Link className="btn" href={`/admin/payroll?month=${month}`}>Back to payroll</Link></div>
        </div>
      );
    }
    throw err;
  }

  const title = MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));
  const company = settings.company;
  const sentStatus = mail.rows.find((r) => r.employeeId === employeeId);

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>Payslip</h1>
          <p>{slip.employee.name} · {title}</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href={`/admin/payroll?month=${month}`}>Back to payroll</Link>
          <EmailPayslipButton
            month={month}
            employeeId={employeeId}
            label="Email this payslip"
            status={sentStatus?.status}
          />
          <PrintButton />
        </div>
      </div>
      {sentStatus?.status === 'sent' && (
        <div className="notice notice-info no-print" style={{ marginBottom: 14 }}>
          Emailed to {sentStatus.email} on {new Date(sentStatus.sentAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}.
        </div>
      )}
      {sentStatus?.status === 'failed' && (
        <div className="notice notice-danger no-print" style={{ marginBottom: 14 }}>
          The last email to {sentStatus.email} failed: {sentStatus.error}
        </div>
      )}

      <div className="card card-pad payslip">
        <div className="row-between" style={{ marginBottom: 16 }}>
          <div className="inline" style={{ gap: 14 }}>
            <CompanyLogo hasLogo={company.hasLogo} version={company.logoUpdatedAt} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{company.name || 'KD Marketing'}</div>
              <div className="muted">Payslip for {title}</div>
            </div>
          </div>
          <div className="muted" style={{ textAlign: 'right' }}>
            {slip.employee.employeeCode ? <div>ID {slip.employee.employeeCode}</div> : null}
            <div>All amounts in US dollars</div>
          </div>
        </div>

        <div className="kv-grid" style={{ marginBottom: 18 }}>
          <div><div className="faint">Employee</div><strong>{slip.employee.name}</strong></div>
          <div><div className="faint">Email</div>{slip.employee.email}</div>
          <div><div className="faint">Department</div>{slip.employee.department || '—'}</div>
          <div><div className="faint">Total hours worked</div><strong>{slip.totalHours}</strong></div>
        </div>

        <div className="kv-grid" style={{ marginBottom: 18 }}>
          <div><div className="faint">Days worked</div><strong>{slip.daysWorked}</strong></div>
          <div><div className="faint">Full days</div><strong>{slip.fullDays}</strong></div>
          <div><div className="faint">Half days</div><strong>{slip.halfDays}</strong></div>
          <div>
            <div className="faint">Other hours</div>
            <strong>{slip.otherHours}</strong>
            {slip.otherDays > 0 && (
              <span className="faint"> over {slip.otherDays} day{slip.otherDays === 1 ? '' : 's'}</span>
            )}
          </div>
        </div>

        {slip.stale && (
          <div className="notice notice-warn no-print" style={{ marginBottom: 14 }}>
            Rates or attendance changed after this month was generated, so this payslip no longer
            matches the Payroll table. Regenerate the month to bring them together.
          </div>
        )}

        {slip.unpricedDays > 0 && (
          <div className="notice notice-warn no-print" style={{ marginBottom: 14 }}>
            {slip.unpricedDays} worked {slip.unpricedDays === 1 ? 'day has' : 'days have'} no pay rate and
            {slip.unpricedDays === 1 ? ' is' : ' are'} not paid. Set a rate that covers
            {slip.unpricedDays === 1 ? ' it' : ' them'}, then regenerate the month.
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Earnings</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {slip.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.kind === 'full' && 'Full days'}
                    {l.kind === 'half' && 'Half days'}
                    {l.kind === 'partial' && `Other hours (over ${l.days} day${l.days === 1 ? '' : 's'})`}
                  </td>
                  <td className="num">{l.kind === 'partial' ? `${l.hours} h` : l.days}</td>
                  <td className="num">
                    {l.kind === 'full' && `${money(l.dailyRate)} / day`}
                    {l.kind === 'half' && `${money(l.dailyRate / 2)} / half day`}
                    {l.kind === 'partial' && `${money(l.hourlyRate)} / hour`}
                  </td>
                  <td className="num">{money(l.amount)}</td>
                </tr>
              ))}
              {slip.lines.length === 0 && (
                <tr><td colSpan={4} className="faint">No paid days this month.</td></tr>
              )}
              <tr>
                <td colSpan={3}><strong>Base pay</strong></td>
                <td className="num"><strong>{money(slip.basePay)}</strong></td>
              </tr>
              {slip.bonuses.map((b) => (
                <tr key={b.id}>
                  <td colSpan={3}>Bonus: {b.reason}</td>
                  <td className="num">{money(b.amount)}</td>
                </tr>
              ))}
              {slip.bonuses.length > 0 && (
                <tr>
                  <td colSpan={3}><strong>Bonuses</strong></td>
                  <td className="num"><strong>{money(slip.bonusTotal)}</strong></td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ fontSize: 16 }}><strong>Net pay</strong></td>
                <td className="num" style={{ fontSize: 16 }}><strong>{money(slip.netPay)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="faint" style={{ marginTop: 14, fontSize: 12 }}>
          A full day ({slip.dayLimits.fullDayHours}+ hours of work) pays the daily rate, a half day (
          {slip.dayLimits.halfDayHours}+ hours) pays half, and other work is paid by the hour. Breaks are
          not counted as work. Bonuses are added on top. Generated on{' '}
          {new Date(slip.generatedOn).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.
        </p>
      </div>
    </>
  );
}
