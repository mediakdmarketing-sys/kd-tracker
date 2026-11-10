'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import { dateLabel, duration, time } from '@/lib/format';
import { BY_KEY } from '../dashboard/states';

const POLL_MS = 60 * 1000;

const STATE_LABEL = { working: 'Working', on_break: 'On break', finished: 'Finished', not_started: 'Not started', on_leave: 'On leave' };

/**
 * The timesheet, kept live: it asks the server again every minute, and between asks counts the
 * running shifts up second by second, so a person who is working shows their hours growing and a
 * person on a break shows the break growing.
 *
 * @param {{ initial: object, query: string, timezone: string }} props
 *   query: the filters as a query string (from, to, department, employee), without paging
 */
export default function LiveTimesheet({ initial, query, timezone }) {
  const [data, setData] = useState(initial);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setData(initial);
    setFetchedAt(Date.now());
  }, [initial]);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      try {
        const next = await call(`/api/admin/timesheet?${query}`);
        if (stopped) return;
        setData(next);
        setFetchedAt(Date.now());
        setError(null);
      } catch (err) {
        // A missed poll is not worth blocking the page for: say so and try again next minute.
        if (!stopped) setError(err.message);
      }
    }
    const id = setInterval(refresh, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [query]);

  const lag = Math.max(0, Math.round((now - fetchedAt) / 1000));
  const multiDay = data.from !== data.to;
  const { summary, rows } = data;

  return (
    <>
      <div className="grid grid-stats">
        <div className="stat">
          <div className="label">People</div>
          <div className="value">{summary.people}</div>
          <div className="sub">{multiDay ? `${data.from} to ${data.to}` : dateLabel(data.from)}</div>
        </div>
        <div className="stat">
          <div className="label">Working now</div>
          <div className="value" style={{ color: BY_KEY.working.color }}>{summary.working}</div>
          <div className="sub">{summary.onBreak} on a break</div>
        </div>
        <div className="stat">
          <div className="label">Hours worked</div>
          <div className="value">{duration(summary.workedSeconds + (summary.working ? lag * summary.working : 0))}</div>
          <div className="sub">all rows below</div>
        </div>
        <div className="stat">
          <div className="label">Break time</div>
          <div className="value">{duration(summary.breakSeconds + (summary.onBreak ? lag * summary.onBreak : 0))}</div>
          <div className="sub">all rows below</div>
        </div>
        <div className="stat">
          <div className="label">Mic muted</div>
          <div className="value" style={{ color: summary.micMutedTimes ? '#e11d48' : undefined }}>{summary.micMutedTimes}</div>
          <div className="sub">
            {summary.micMutedTimes
              ? `times, ${summary.micMutedPeople} ${summary.micMutedPeople === 1 ? 'person' : 'people'}${summary.micMutedNow ? `, ${summary.micMutedNow} muted now` : ''}`
              : 'no muted mic found'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Needs a look</div>
          <div className="value" style={{ color: summary.flagged ? '#e11d48' : undefined }}>{summary.flagged}</div>
          <div className="sub">over break or to check</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Timesheet</h2>
          <span className="faint">
            Live: updated {lag < 5 ? 'just now' : `${lag}s ago`}, refreshes every minute
            {error ? ' · the last refresh failed, showing the previous figures' : ''}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">Nobody matches these filters{multiDay ? ' in this range' : ''}.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {multiDay && <th>Date</th>}
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Now</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Worked</th>
                  <th>Break</th>
                  <th>Idle</th>
                  <th>Mic muted</th>
                  <th>Screenshots</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const live = r.state === 'working' ? lag : 0;
                  const onBreakNow = r.state === 'on_break' ? lag : 0;
                  const s = BY_KEY[r.state] || BY_KEY.not_started;
                  return (
                    <tr key={`${r.employeeId}|${r.date}`}>
                      {multiDay && <td className="num">{dateLabel(r.date)}</td>}
                      <td>
                        <Link href={`/admin/employees/${r.employeeId}?date=${r.date}`}>{r.name}</Link>
                      </td>
                      <td className="muted">{r.department || '—'}</td>
                      <td>
                        <span className="ts-state" style={{ '--c': s.color }}>{STATE_LABEL[r.state] || r.state}</span>
                      </td>
                      <td className="num">{r.punchIn ? time(r.punchIn, timezone) : '—'}</td>
                      <td className="num">
                        {r.punchOut ? time(r.punchOut, timezone) : r.punchIn ? <span className="faint">now</span> : '—'}
                      </td>
                      <td className="num">{r.punchIn ? duration(r.workedSeconds + live) : '—'}</td>
                      <td className="num">{r.punchIn ? duration(r.breakSeconds + onBreakNow) : '—'}</td>
                      <td className="num">{r.punchIn ? duration(r.idleSeconds) : '—'}</td>
                      <td>
                        {r.micMutedTimes > 0 ? (
                          <Link
                            href={`/admin/mic-log?from=${r.date}&to=${r.date}`}
                            className="inline"
                            style={{ gap: 6, flexWrap: 'nowrap', textDecoration: 'none' }}
                            title={`Muted ${r.micMutedTimes} ${r.micMutedTimes === 1 ? 'time' : 'times'}${r.micMutedSeconds ? `, ${duration(r.micMutedSeconds)} in all` : ''}. Open the Mic log for the times.`}
                          >
                            <span className="pill pill-flag">{r.micMutedTimes}×</span>
                            {r.micMutedSeconds > 0 && <span className="muted" style={{ fontSize: 12 }}>{duration(r.micMutedSeconds)}</span>}
                            {r.micMutedNow && <span className="pill pill-flag" style={{ fontWeight: 700 }}>Muted now</span>}
                          </Link>
                        ) : (
                          <span className="faint">{r.punchIn ? '0' : '—'}</span>
                        )}
                      </td>
                      <td className="num">
                        {r.screenshots > 0 ? <a href={`#shots-${r.employeeId}`}>{r.screenshots}</a> : <span className="faint">0</span>}
                      </td>
                      <td>
                        <span className="inline" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {r.overBreak && <span className="pill pill-flag">Over break</span>}
                          {r.needsReview && <span className="pill pill-flag" title={r.reviewReason || undefined}>To check</span>}
                          {r.shifts > 1 && <span className="faint" style={{ fontSize: 11 }}>{r.shifts} shifts</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
