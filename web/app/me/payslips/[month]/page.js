import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import PayslipSheet from '@/components/PayslipSheet';
import PrintButton from '@/app/admin/payroll/payslip/[employeeId]/PrintButton';

export const metadata = { title: 'Payslip · WorkBuddy' };

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function MyPayslipPage({ params }) {
  const { month } = await params;
  await requireUser();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return <div className="notice notice-danger">That is not a month.</div>;
  }

  let data;
  try {
    data = await api(`/api/payslips/${month}`);
  } catch (err) {
    if (err.status === 404) {
      return (
        <div className="stack">
          <div className="notice notice-warn">There is no payslip for that month yet. It appears once HR finalizes the month.</div>
          <div><Link className="btn" href="/me/payslips">Back to my payslips</Link></div>
        </div>
      );
    }
    throw err;
  }

  const title = MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>Payslip</h1>
          <p>{title}</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/me/payslips">All payslips</Link>
          <a className="btn btn-info" href={`/bff/api/payslips/${month}/pdf`}>Download PDF</a>
          <PrintButton />
        </div>
      </div>

      <PayslipSheet slip={data.slip} company={data.company} template={data.template} monthTitle={title} />
    </>
  );
}
