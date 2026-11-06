import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import PayslipSheet from '@/components/PayslipSheet';
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
          <Link className="btn" href="/admin/settings#payslip-look">Change the look</Link>
          <a className="btn" href={`/bff/api/payroll/payslip.pdf?employeeId=${employeeId}&month=${month}`}>
            Download PDF
          </a>
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
          Emailed to {sentStatus.email} on {new Date(sentStatus.sentAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}
          {sentStatus.timesSent > 1 ? ` (sent ${sentStatus.timesSent} times)` : ''}. Sending it again attaches a PDF marked DUPLICATE.
        </div>
      )}
      {sentStatus?.status === 'failed' && (
        <div className="notice notice-danger no-print" style={{ marginBottom: 14 }}>
          The last email to {sentStatus.email} failed: {sentStatus.error}
        </div>
      )}
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

      <PayslipSheet slip={slip} company={settings.company} template={settings.payslip} monthTitle={title} />
    </>
  );
}
