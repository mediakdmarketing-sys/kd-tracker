'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import { duration, time, STATE_LABEL, STATE_CLASS } from '@/lib/format';
import useSSE from '@/lib/useSSE';

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'working', label: 'Working' },
  { key: 'on_break', label: 'On break' },
  { key: 'punched_out', label: 'Punched out' },
  { key: 'not_started', label: 'Not started' },
  { key: 'on_leave', label: 'On leave' },
  { key: 'flagged', label: 'Needs review' },
];

// Fallback poll interval when SSE is not available or has not sent an event recently.
// This is intentionally generous — SSE handles the real-time case; polling is a safety net.
const FALLBACK_POLL_MS = 5 * 60 * 1000; // 5 minutes

// Active filter style defined once outside the component so it is not a new object on every
// render — previously this was an inline literal inside a .map() that ran every second.
const ACTIVE_FILTER_STYLE = {
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  color: 'var(--accent-text)',
};

/**
 * Isolated last-refresh display.
 *
 * Shows "Updated X ago" that ticks every 30 s without touching the board table.
 */
const LastUpdatedDisplay = memo(function LastUpdatedDisplay({ updatedAt, refreshing }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (refreshing) return <span>Refreshing…</span>;

  const ageSeconds = Math.floor((Date.now() - updatedAt) / 1000);
  if (ageSeconds < 10) return <span>Just updated</span>;
  if (ageSeconds < 60) return <span>Updated {ageSeconds}s ago</span>;
  const mins = Math.floor(ageSeconds / 60);
  return <span>Updated {mins}m ago</span>;
});

/**
 * Live board for /admin.
 *
 * Receives real-time `attendance_changed` events via SSE — any punch-in, punch-out or break
 * triggers an immediate refetch so the board reflects the change within ~200 ms instead of
 * waiting up to 5 minutes. The 5-minute fallback poll remains as a safety net in case SSE is
 * unavailable (Vercel serverless, proxy timeout, etc.).
 *
 * Story W-4 originally deferred sockets to backlog I-3; SSE achieves the same goal with
 * much less infrastructure change.
 */
export default function LiveBoard({ initial, timezone, shiftTargetSeconds }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState('all');
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  // Track whether SSE is delivering events so the fallback poll knows when to step in.
  const lastSseEventRef = useRef(null);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await call('/api/admin/dashboard');
      setData(next);
      setStale(false);
      setUpdatedAt(Date.now());
    } catch {
      setStale(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // SSE: refresh immediately when any employee's attendance changes.
  useSSE('attendance_changed', useCallback(() => {
    lastSseEventRef.current = Date.now();
    doRefresh();
  }, [doRefresh]));

  // Fallback polling — only fires if SSE hasn't delivered an event in a while.
  // This covers: Vercel serverless (SSE times out at 25 s), proxy timeouts, or a
  // browser that does not support EventSource.
  useEffect(() => {
    const id = setInterval(() => {
      const lastSse = lastSseEventRef.current;
      const sseIsLive = lastSse && Date.now() - lastSse < FALLBACK_POLL_MS * 1.5;
      if (!sseIsLive) doRefresh();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [doRefresh]);

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
        <Stat label="On leave" value={data.summary.onLeave || 0} tone="var(--danger)" />
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
              <LastUpdatedDisplay updatedAt={updatedAt} refreshing={refreshing} />
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
                    <td className="num">
                      {duration(row.workedSeconds)}
                      {shiftTargetSeconds && row.workedSeconds > shiftTargetSeconds ? (
                        <span
                          className="pill pill-flag"
                          style={{ marginLeft: 6, fontSize: 11 }}
                          title={`Over the ${duration(shiftTargetSeconds)} shift target`}
                        >
                          OT
                        </span>
                      ) : null}
                    </td>
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
