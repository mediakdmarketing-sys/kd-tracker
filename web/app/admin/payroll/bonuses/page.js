import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import { currentMonth } from '@/lib/format';
import BonusManager from './BonusManager';

export const metadata = { title: 'Bonuses · WorkBuddy' };

export default async function BonusesPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const month = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : currentMonth(user.timezone);
  const [bonuses, employees] = await Promise.all([
    api(`/api/payroll/bonuses?month=${month}`),
    api('/api/payroll/rates'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bonuses</h1>
          <p>Extra pay added to an employee&apos;s payslip for the month, in US dollars.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/admin/payroll">Payroll</Link>
          <Link className="btn" href="/admin/payroll/rates">Pay rates</Link>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter fields={[{ name: 'month', label: 'Month', type: 'month', defaultValue: month }]} />
          </Suspense>
        </div>
        <BonusManager
          month={month}
          rows={bonuses.rows}
          employees={employees.rows.map((e) => ({ id: e.employeeId, name: e.name, email: e.email }))}
        />
      </div>
    </>
  );
}
