import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { currentMonth, todayIn } from '@/lib/format';
import YearCalendar from '@/components/YearCalendar';

export const metadata = { title: 'Holidays · WorkInvigilator' };

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

export default async function CompanyCalendarPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser();

  const year = /^\d{4}$/.test(params.year || '') ? params.year : currentMonth(user.timezone).slice(0, 4);
  const { holidays } = await api(`/api/calendar?year=${year}`);
  const y = Number(year);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Holidays</h1>
          <p>Company holidays and Sundays. Nobody works on these days, and punching in is closed.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" href="/calendar">Month view</Link>
          <Link className="btn" href={`/me/calendar?year=${y - 1}`}>← {y - 1}</Link>
          <Link className="btn" href={`/me/calendar?year=${y + 1}`}>{y + 1} →</Link>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <YearCalendar year={y} holidays={holidays} todayKey={todayIn(user.timezone)} />
        </div>

        <div className="card">
          <div className="card-head"><h2>Holidays in {year}</h2><span className="muted">{holidays.length}</span></div>
          {holidays.length === 0 ? (
            <div className="empty">No holidays have been set for {year} yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.date}>
                      <td>{WEEKDAY.format(new Date(`${h.date}T00:00:00Z`))}</td>
                      <td>{h.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
