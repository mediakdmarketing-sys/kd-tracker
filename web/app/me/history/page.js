import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import Pager from '@/components/Pager';
import {
  duration,
  hours,
  time,
  dateLabel,
  dayName,
  daysAgoDate,
  todayIn,
  workedSecondsOf,
  breakSecondsOf,
} from '@/lib/format';

export const metadata = { title: 'My history · KD Tracker' };

export default async function HistoryPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser();

  const from = params.from || daysAgoDate(30, user.timezone);
  const to = params.to || todayIn(user.timezone);
  const page = params.page || '1';

  const query = new URLSearchParams({ from, to, page, limit: '25' });
  const result = await api(`/api/attendance/me?${query}`);

  const totals = result.data.reduce(
    (acc, s) => ({
      worked: acc.worked + workedSecondsOf(s),
      breaks: acc.breaks + breakSecondsOf(s),
      idle: acc.idle + (s.idleSeconds || 0),
    }),
    { worked: 0, breaks: 0, idle: 0 }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My history</h1>
          <p>Every shift recorded against your account.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
              ]}
            />
          </Suspense>
        </div>

        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Worked</div>
            <div className="value">{duration(totals.worked)}</div>
            <div className="sub">{hours(totals.worked)} hours on this page</div>
          </div>
          <div className="stat">
            <div className="label">Break</div>
            <div className="value">{duration(totals.breaks)}</div>
          </div>
          <div className="stat">
            <div className="label">Idle</div>
            <div className="value">{duration(totals.idle)}</div>
            <div className="sub">no keyboard or mouse activity</div>
          </div>
          <div className="stat">
            <div className="label">Shifts</div>
            <div className="value">{result.pagination.total}</div>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Worked</th>
                  <th>Break</th>
                  <th>Idle</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {result.data.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">No shifts in this range.</div>
                    </td>
                  </tr>
                ) : (
                  result.data.map((shift) => (
                    <tr key={shift.id}>
                      <td>
                        {dateLabel(shift.date)} <span className="faint">{dayName(shift.date)}</span>
                      </td>
                      <td className="num">{time(shift.punchIn, user.timezone)}</td>
                      <td className="num">{time(shift.punchOut, user.timezone)}</td>
                      <td className="num">{duration(workedSecondsOf(shift))}</td>
                      <td className="num">{duration(breakSecondsOf(shift))}</td>
                      <td className="num muted">{duration(shift.idleSeconds)}</td>
                      <td>
                        {shift.needsReview ? (
                          <span className="pill pill-flag" title={shift.reviewReason || ''}>
                            {shift.autoClosed ? 'Auto-closed' : 'Over break'}
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager pagination={result.pagination} searchParams={{ from, to }} basePath="/me/history" />
        </div>
      </div>
    </>
  );
}
