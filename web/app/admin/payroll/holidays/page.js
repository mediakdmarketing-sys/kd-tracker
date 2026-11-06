import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { currentMonth, todayIn } from '@/lib/format';
import HolidaysManager from './HolidaysManager';

export const metadata = { title: 'Holidays · WorkBuddy' };

export default async function HolidaysPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const year = /^\d{4}$/.test(params.year || '') ? params.year : currentMonth(user.timezone).slice(0, 4);
  const [holidays, settings, birthdays] = await Promise.all([
    api(`/api/payroll/holidays?year=${year}`),
    api('/api/admin/settings'),
    api(`/api/admin/birthdays?year=${year}`),
  ]);
  const y = Number(year);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Holidays</h1>
          <p>
            Days the whole company is off. Each is paid at the daily rate, on a working day, to everyone active
            who has a pay rate.
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/admin/payroll">Payroll</Link>
          <Link className="btn" href={`/admin/payroll/holidays?year=${y - 1}`}>← {y - 1}</Link>
          <Link className="btn" href={`/admin/payroll/holidays?year=${y + 1}`}>{y + 1} →</Link>
        </div>
      </div>

      <div className="stack">
        <HolidaysManager
          year={year}
          rows={holidays.rows}
          birthdays={birthdays.rows}
          workDays={settings.payroll.workDays}
          today={todayIn(user.timezone)}
        />
        <div className="notice notice-info">
          <strong>Sundays are always a day off:</strong> nobody can punch in on a Sunday or on a holiday, and Sundays
          are not paid. Holidays that fall on a day that is not a working day are not paid. Working days and which
          leave is paid are set in <Link href="/admin/settings">Settings</Link>. A finalized month cannot change its
          holidays. Removing a holiday also removes it from later years that have not been created yet.
        </div>
      </div>
    </>
  );
}
