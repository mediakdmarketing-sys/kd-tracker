import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { currentMonth, todayIn } from '@/lib/format';
import MonthCalendar from '@/components/MonthCalendar';

export const metadata = { title: 'Calendar · WorkInvigilator' };

const TITLE = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-12" plus or minus some months. */
function shift(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const SUBTITLE = {
  admin: 'Holidays, everyone’s leave and birthdays. Click a day to see it, or to mark a holiday.',
  leader: 'Holidays, your team’s leave and birthdays.',
  user: 'Holidays and your own leave. Sundays and holidays are days off: punching in is closed.',
};

export default async function CalendarPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser();

  const nowMonth = currentMonth(user.timezone);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || '') ? params.month : nowMonth;
  const data = await api(`/api/calendar/month?month=${month}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar · {TITLE.format(new Date(`${month}-01T00:00:00Z`))}</h1>
          <p>{SUBTITLE[user.role] || SUBTITLE.user}</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href={`/calendar?month=${shift(month, -1)}`}>← Previous</Link>
          {month !== nowMonth && <Link className="btn" href="/calendar">Today</Link>}
          <Link className="btn" href={`/calendar?month=${shift(month, 1)}`}>Next →</Link>
          <Link className="btn" href={`/me/calendar?year=${month.slice(0, 4)}`}>Year view</Link>
          {user.role === 'admin' && <Link className="btn" href={`/admin/payroll/holidays?year=${month.slice(0, 4)}`}>Holiday list &amp; upload</Link>}
        </div>
      </div>

      <div className="stack">
        <MonthCalendar
          key={month}
          month={month}
          start={data.start}
          end={data.end}
          today={todayIn(user.timezone)}
          role={user.role}
          holidays={data.holidays}
          leave={data.leave}
          birthdays={data.birthdays}
        />
      </div>
    </>
  );
}
