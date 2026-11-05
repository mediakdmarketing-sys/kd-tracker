import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RatesManager from './RatesManager';

export const metadata = { title: 'Pay rates · WorkBuddy' };

export default async function RatesPage() {
  await requireUser({ adminOnly: true });
  const { rows } = await api('/api/payroll/rates');

  const withoutRate = rows.filter((r) => r.currentRate === null).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pay rates</h1>
          <p>
            What each employee is paid per day worked, in US dollars. A raise is a new rate with a
            start date; every day is paid at the rate in force on that day.
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/admin/payroll">Payroll</Link>
          <Link className="btn" href="/admin/payroll/bonuses">Bonuses</Link>
        </div>
      </div>

      <div className="stack">
        {withoutRate > 0 && (
          <div className="notice notice-warn">
            <strong>{withoutRate}</strong> {withoutRate === 1 ? 'employee has' : 'employees have'} no rate
            yet. Days they work are paid nothing until a rate that covers those days is set and the
            month is regenerated.
          </div>
        )}
        <RatesManager rows={rows} />
        <div className="notice notice-info">
          A <strong>full day</strong> (9 hours of work by default) pays the daily rate, a{' '}
          <strong>half day</strong> (4.5 hours) pays half, and less than that is paid by the hour.
          Breaks are never counted as work, so a person who takes a break and stays late to finish
          their hours gets a full day like one who takes none. The limits are in{' '}
          <Link href="/admin/settings">Settings</Link>.
        </div>
      </div>
    </>
  );
}
