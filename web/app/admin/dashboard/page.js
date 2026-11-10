import { api, requireUser } from '@/lib/api';
import { todayIn } from '@/lib/format';
import MonthFilter from './MonthFilter';
import AttendanceChart from './AttendanceChart';
import DepartmentBars from './DepartmentBars';
import TeamToday from './TeamToday';
import Attention from './Attention';

export const metadata = { title: 'Dashboard · WorkBuddy' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-12" plus or minus some months. */
function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Tile colours: [from, to, text]. Text is dark only on the light amber.
const TILES = [
  { key: 'working', label: 'Working', value: (s) => s.working, colors: ['#059669', '#047857', '#fff'] },
  { key: 'onBreak', label: 'On break', value: (s) => s.onBreak, colors: ['#fbbf24', '#f59e0b', '#3b2300'] },
  { key: 'punchedOut', label: 'Finished', value: (s) => s.punchedOut, colors: ['#0284c7', '#075985', '#fff'] },
  { key: 'notStarted', label: 'Not started', value: (s) => s.notStarted, colors: ['#64748b', '#334155', '#fff'] },
  { key: 'onLeave', label: 'On leave', value: (s) => s.onLeave, colors: ['#7c3aed', '#5b21b6', '#fff'] },
  { key: 'flagged', label: 'Needs a look', value: (s) => s.flagged, colors: ['#e11d48', '#be123c', '#fff'] },
];

export default async function DashboardPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });
  const tz = user.timezone;

  // Default view is the current month alone; picking From and To compares every month between.
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);
  // Same rules as the filter, applied to the URL too: no future months, and To never before From.
  let from = MONTH.test(params.from || '') ? params.from : thisMonth;
  if (from > thisMonth) from = thisMonth;
  let to = MONTH.test(params.to || '') ? params.to : from;
  if (to > thisMonth) to = thisMonth;
  if (to < from) to = from;

  // The extras (leave, calendar) must never take the dashboard down with them.
  const soft = (promise) => promise.catch(() => null);
  const [live, data, pendingLeave, calThis, calNext] = await Promise.all([
    api('/api/admin/dashboard'),
    api(`/api/admin/attendance-summary?${new URLSearchParams({ from, to })}`),
    soft(api('/api/admin/leave?status=pending')),
    soft(api(`/api/calendar/month?month=${thisMonth}`)),
    soft(api(`/api/calendar/month?month=${shiftMonth(thisMonth, 1)}`)),
  ]);

  const { summary, employees } = live;
  const onShift = summary.working + summary.onBreak;

  // People who need a look: over their break, a shift to confirm, or working with no activity.
  const flaggedAll = employees
    .map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      reasons: [e.overBreak && 'Over break', e.needsReview && 'Shift to check', e.appearsIdle && 'Looks idle'].filter(Boolean),
    }))
    .filter((e) => e.reasons.length);

  // Leave waiting for a decision. Your own is left out: another admin has to decide it.
  const mine = (pendingLeave || []).filter((r) => r.employeeId !== user.id);

  const calendars = [calThis, calNext].filter(Boolean);
  const weekEnd = addDays(today, 7);
  const birthdays = calendars
    .flatMap((c) => c.birthdays)
    .filter((b) => b.date >= today && b.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date));
  const holiday = calendars
    .flatMap((c) => c.holidays)
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateText = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(new Date());
  const first = String(user.name || '').split(' ')[0];

  const singleMonth = from === to;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting}{first ? `, ${first}` : ''}</h1>
          <p>
            {dateText}.{' '}
            {summary.total === 0
              ? 'No active employees yet.'
              : `${onShift} of ${summary.total} ${summary.total === 1 ? 'person is' : 'people are'} on shift right now.`}
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="dash-tiles">
          {TILES.map((t) => (
            <div key={t.key} className="dash-tile" style={{ '--from': t.colors[0], '--to': t.colors[1], '--ink': t.colors[2] }}>
              <b>{t.value(summary)}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>

        <div className="dash-grid">
          <div className="card">
            <div className="card-head">
              <h2>Team today</h2>
              <span className="faint">Each circle is a person. Hover for their name and hours.</span>
            </div>
            <div className="card-pad">
              <TeamToday employees={employees} summary={summary} />
              <ul className="dash-legend">
                {[
                  ['#10b981', 'Working'],
                  ['#f59e0b', 'On break'],
                  ['#0ea5e9', 'Finished'],
                  ['#94a3b8', 'Not started'],
                  ['#8b5cf6', 'On leave'],
                  ['#f43f5e', 'Needs a look'],
                ].map(([color, label]) => (
                  <li key={label} style={{ '--c': color }}>{label}</li>
                ))}
              </ul>
            </div>
          </div>

          <Attention
            pending={mine.slice(0, 4)}
            pendingTotal={mine.length}
            flagged={flaggedAll.slice(0, 5)}
            flaggedTotal={flaggedAll.length}
            birthdays={birthdays.slice(0, 4)}
            holiday={holiday}
            today={today}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Attendance by department</h2>
            <span className="faint">
              {singleMonth ? 'Average days attended per person this month' : 'Average days per person, one line per month (0 to 26)'}
            </span>
          </div>
          <div className="card-pad">
            <MonthFilter key={`${from}|${to}`} from={from} to={to} maxMonth={thisMonth} />
            <div style={{ marginTop: 18 }}>
              {singleMonth ? (
                <DepartmentBars departments={data.departments} values={data.months[0]?.values || []} />
              ) : (
                <AttendanceChart departments={data.departments} months={data.months} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
