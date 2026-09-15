import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import ShiftPanel from '@/components/ShiftPanel';
import WorkTimeClock from '@/components/WorkTimeClock';
import { duration, time, timeSec, workedSecondsOf, breakSecondsOf, isOpenShift } from '@/lib/format';

/** Whole-hours target reads as "8h", not "8h 00m" — minutes only show up when there are any. */
function hoursLabel(seconds) {
  const h = Math.floor((seconds || 0) / 3600);
  const m = Math.round(((seconds || 0) % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Break time/allowance read in plain minutes ("0m", "60m") rather than the "Xh Ym" duration()
 * format used elsewhere — a break is rarely long enough for hours to matter. */
function minutesLabel(seconds) {
  return `${Math.round((seconds || 0) / 60)}m`;
}

export const metadata = { title: 'My shift · WorkBuddy' };

export default async function MyShiftPage() {
  const [user, status, projects] = await Promise.all([
    requireUser(),
    api('/api/attendance/status'),
    api('/api/projects'),
  ]);

  const shift   = status.shift ?? null;
  const isOpen  = isOpenShift(shift);
  const punched = status.state !== 'punched_out';

  const todayWorked = workedSecondsOf(shift);
  const todayBreak  = breakSecondsOf(shift);
  const breaks      = shift?.breaks ?? [];

  const shiftTarget    = status.shiftTargetSeconds ?? 32400;
  const remainingToday = Math.max(shiftTarget - todayWorked, 0);
  const targetReached  = punched && remainingToday === 0 && todayWorked > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <p>
            {punched
              ? `Punched in at ${time(shift.punchIn, user.timezone)}.`
              : 'You are not punched in.'}
          </p>
        </div>
      </div>

      <div className="stack">
        {/* Live punch controls + ticking clock */}
        <ShiftPanel initial={status} timezone={user.timezone} projects={projects} />

        {/* Today's at-a-glance stats */}
        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Required Work</div>
            <div className="value">{hoursLabel(shiftTarget)}</div>
          </div>

          <div className="stat">
            <div className="label">Work Time</div>
            <div className="value">
              {/* Same base value ShiftPanel's own "Worked today" clock uses (status.workedSeconds,
                  not the workedSecondsOf(shift) recompute below) — that recompute uses Date.now()
                  at SSR render time, which lags behind the backend's own snapshot by however long
                  the request took, so the two clocks would start a second or two apart and never
                  agree until the next poll. */}
              <WorkTimeClock state={status.state} baseWorked={status.workedSeconds || 0} />
            </div>
          </div>

          <div className="stat">
            <div className="label">Break Time</div>
            <div className="value">{minutesLabel(todayBreak)}</div>
            <div className="sub">Allowed: {minutesLabel(status.breakAllowanceSeconds ?? 3600)}</div>
          </div>

          <div className="stat">
            <div className="label">Time Remaining</div>
            <div className="value" style={targetReached ? { color: 'var(--ok)' } : undefined}>
              {targetReached ? 'Done' : duration(remainingToday)}
            </div>
          </div>
        </div>

        {/* Today's shift detail — punch in/out + break table */}
        {shift && (
          <div className="card">
            <div className="card-head">
              <h2>Today&apos;s shift</h2>
              <div className="inline">
                <span className="faint">
                  {time(shift.punchIn, user.timezone)}
                  {' — '}
                  {shift.punchOut ? time(shift.punchOut, user.timezone) : 'ongoing'}
                </span>
                {isOpen ? (
                  <span className="pill pill-working">Working</span>
                ) : (
                  <span className="pill pill-out">Closed</span>
                )}
              </div>
            </div>

            {/* Break times table — only shown when at least one break was taken */}
            {breaks.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Break start</th>
                      <th>Break end</th>
                      <th>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breaks.map((b) => (
                      <tr key={b.id}>
                        <td className="num">{timeSec(b.start, user.timezone)}</td>
                        <td className="num">
                          {b.end
                            ? timeSec(b.end, user.timezone)
                            : <span className="pill pill-break">On break now</span>}
                        </td>
                        <td className="num">
                          {b.end
                            ? duration(b.durationSeconds)
                            : <span className="faint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty" style={{ padding: '16px 18px' }}>
                No breaks taken yet.
              </div>
            )}

            {shift.needsReview && (
              <div className="notice notice-warn" style={{ margin: '0 18px 14px' }}>
                <strong>Flagged for review.</strong>{' '}
                {shift.reviewReason || 'This shift has been flagged for HR.'}
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'right' }}>
          <Link href="/me/history" className="btn">
            Full history →
          </Link>
        </div>
      </div>
    </>
  );
}
