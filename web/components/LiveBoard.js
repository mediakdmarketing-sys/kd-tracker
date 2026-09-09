'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import { duration, time, STATE_LABEL, STATE_CLASS } from '@/lib/format';

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'working', label: 'Working' },
  { key: 'on_break', label: 'On break' },
  { key: 'punched_out', label: 'Punched out' },
  { key: 'not_started', label: 'Not started' },
  { key: 'flagged', label: 'Needs review' },
];

const POLL_MS = 5 * 60 * 1000; // 5 minutes

// Active filter style defined once outside the component so it is not a new object on every
// render — previously this was an inline literal inside a .map() that ran every second.
const ACTIVE_FILTER_STYLE = {
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  color: 'var(--accent-text)',
};

/**
 * Isolated countdown ticker.
 *
 * This component owns the 1-second setInterval. By keeping it separate, the parent
 * LiveBoard (and its 60-row employee table) only re-renders when new data arrives from the
 * server — not every second. Previously secsLeft lived in LiveBoard state, causing the
 * entire board to re-render 60+ rows per second.
 */
function CountdownDisplay({ pollMs, onExpire }) {
  const [secsLeft, setSecsLeft] = useState(pollMs / 1000);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          onExpire();
          return pollMs / 1000;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [pollMs, onExpire]);

  return (
    <span>
      {secsLeft >= 60 ? `${Math.ceil(secsLeft / 60)}m` : `${secsLeft}s`}
    </span>
  );
}

/**
 * Story W-4. Polls every 5 minutes rather than holding a socket open: the payload is small,
 * 60 employees is a single query, and polling survives a dropped connection without reconnect
 * logic. Sockets are backlog I-3 for sub-second freshness.
 *
 * The countdown display is isolated in CountdownDisplay so the employee table only re-renders
 * when the data actually changes, not every second.
 */
export default function LiveBoard({ initial, timezone }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState('all');
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await call('/api/admin/dashboard');
      setData(next);
      setStale(false);
    } catch {
      setStale(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const rows = data.employees.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'flagged') return row.needsReview || row.overBreak;
    return row.state === filter;
  });

  return (
    <div className="stack">
      {stale ? (
        <div className="notice notice-warn">
          Could not reach the server on the last refresh — these figures may be out of date.
        </div>
      ) : null}

      <div className="grid grid-stats">
        <Stat label="Working" value={data.summary.working} tone="var(--ok)" />
        <Stat label="On break" value={data.summary.onBreak} tone="var(--warn)" />
        <Stat label="Punched out" value={data.summary.punchedOut} />
        <Stat label="Not started" value={data.summary.notStarted} />
        <Stat label="Needs review" value={data.summary.flagged} tone="var(--danger)" />
      </div>

      <div className="card">
        <div className="card-head">
          <div className="inline">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="btn"
                onClick={() => setFilter(f.key)}
                style={filter === f.key ? ACTIVE_FILTER_STYLE : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="inline" style={{ gap: 10 }}>
            <span className="faint">
              Updated {time(data.generatedAt, timezone)}
              {' · next in '}
              <CountdownDisplay pollMs={POLL_MS} onExpire={doRefresh} />
            </span>
            <button
              type="button"
              className="btn"
              onClick={doRefresh}
              disabled={refreshing}
              title="Refresh now"
              style={{ padding: '2px 10px', fontSize: 12 }}
            >
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>State</th>
                <th>In</th>
                <th>Worked</th>
                <th>Break</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">Nobody in this view.</div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <Link href={`/admin/employees/${row.employeeId}`}>{row.name}</Link>
                      <div className="faint">{row.email}</div>
                    </td>
                    <td className="muted">{row.department || '—'}</td>
                    <td>
                      <div className="inline">
                        <span className={`pill ${STATE_CLASS[row.state]}`}>{STATE_LABEL[row.state]}</span>
                        {row.overnight ? (
                          <span className="pill pill-out" title={`Shift started ${row.shiftDate}`}>
                            Overnight
                          </span>
                        ) : null}
                        {row.appearsIdle ? <span className="pill pill-idle">Idle</span> : null}
                        {row.needsReview ? <span className="pill pill-flag">Review</span> : null}
                      </div>
                    </td>
                    <td className="num">{time(row.punchIn, timezone)}</td>
                    <td className="num">{duration(row.workedSeconds)}</td>
                    <td className="num">
                      <span className={row.overBreak ? 'pill pill-flag' : undefined}>
                        {duration(row.breakSeconds)}
                      </span>
                    </td>
                    <td className="num muted">
                      {row.lastActivityAt ? time(row.lastActivityAt, timezone) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}
