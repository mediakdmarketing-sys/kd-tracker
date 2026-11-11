import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { money } from '@/lib/money';

export const metadata = { title: 'My payslips · WorkInvigilator' };

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function MyPayslipsPage() {
  await requireUser();
  const { rows } = await api('/api/payslips');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My payslips</h1>
          <p>Your payslip for a month appears here once HR has finalized that month.</p>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            No payslips yet. When HR finalizes a month you get a notification and its payslip shows up here.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Month</th><th>Days worked</th><th>Net pay</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <td>{MONTH_NAME.format(new Date(`${r.month}-01T00:00:00Z`))}</td>
                    <td className="num">{r.daysWorked}</td>
                    <td className="num"><strong>{money(r.netPay)}</strong></td>
                    <td>
                      <div className="inline" style={{ gap: 6 }}>
                        <Link className="btn" href={`/me/payslips/${r.month}`}>View</Link>
                        <a className="btn" href={`/bff/api/payslips/${r.month}/pdf`}>Download PDF</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
