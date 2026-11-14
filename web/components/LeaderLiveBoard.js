'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import { duration, time, STATE_LABEL, STATE_CLASS } from '@/lib/format';
import useSSE from '@/lib/useSSE';

const FALLBACK_POLL_MS = 5 * 60 * 1000;

/**
 * Live board for the Leader view — mirrors LiveBoard.js but calls /api/leader/members
 * and scopes SSE refresh to the leader's own department.
 *
 * The leader only sees their own department's employees; `attendance_changed` events that
 * arrive here are already filtered by the SSE hub to leaders of the affected department.
 */
export default function LeaderLiveBoard({ initial, timezone, shiftTargetSeconds }) {
  const [data, setData] = useState(initial);
  const lastSseRef = useRef(null);

  const doRefresh = useCallback(async () => {
    try {
      const next = await call('/api/leader/members');
      setData(next);
    } catch {
      /* stale data is acceptable; a stale banner is added when needed */
    }
  }, []);

  // SSE: immediate refresh when any team member punches in/out/breaks.
  useSSE('attendance_changed', useCallback(() => {
    lastSseRef.current = Date.now();
    doRefresh();
  }, [doRefresh]));

  // Fallback poll when SSE is unavailable.
  useEffect(() => {
    const id = setInterval(() => {
      const last = lastSseRef.current;
      const sseIsLive = last && Date.now() - last < FALLBACK_POLL_MS * 1.5;
      if (!sseIsLive) doRefresh();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [doRefresh]);

  const { summary, employees: rows } = data;

  return (
    <div className="stack">
      <div className="grid grid-stats">
        <div className="stat">
          <div className="label">Working</div>
          <div className="value" style={{ color: 'var(--ok)' }}>{summary.working}</div>
        </div>
        <div className="stat">
          <div className="label">On break</div>
          <div className="value" style={{ color: 'var(--warn)' }}>{summary.onBreak}</div>
        </div>
        <div className="stat">
          <div className="label">Punched out</div>
          <div className="value">{summary.punchedOut}</div>
        </div>
        <div className="stat">
          <div className="label">Not started</div>
          <div className="value">{summary.notStarted}</div>
        </div>
        <div className="stat">
          <div className="label">On leave</div>
          <div className="value" style={{ color: 'var(--idle)' }}>{summary.onLeave || 0}</div>
        </div>
      </div>

      <div className="card">
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">No members found.</div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <div>{row.name}</div>
                      <div className="faint">{row.email}</div>
                    </td>
                    <td className="muted">{row.department || '—'}</td>
                    <td>
                      <div className="inline">
                        <span className={`pill ${STATE_CLASS[row.state]}`}>
                          {STATE_LABEL[row.state]}
                        </span>
                        {row.appearsIdle && <span className="pill pill-idle">Idle</span>}
                        {row.needsReview && <span className="pill pill-flag">Review</span>}
                      </div>
                    </td>
                    <td className="num">{row.punchIn ? time(row.punchIn, timezone) : '—'}</td>
                    <td className="num">
                      {duration(row.workedSeconds)}
                      {row.workedSeconds > shiftTargetSeconds ? (
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
                    <td>
                      <Link href={`/leader/members/${row.employeeId}`} className="btn">
                        View →
                      </Link>
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
