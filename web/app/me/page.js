import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import ShiftPanel from '@/components/ShiftPanel';
import { duration, time, workedSecondsOf, breakSecondsOf, isOpenShift } from '@/lib/format';

export const metadata = { title: 'My shift · KD Tracker' };

export default async function MyShiftPage() {
  const [user, status] = await Promise.all([
    requireUser(),
    api('/api/attendance/status'),
  ]);

  const shift   = status.shift ?? null;
  const isOpen  = isOpenShift(shift);
  const punched = status.state !== 'punched_out';

  const todayWorked = workedSecondsOf(shift);
  const todayBreak  = breakSecondsOf(shift);
  const breaks      = shift?.breaks ?? [];

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
        <ShiftPanel initial={status} timezone={user.timezone} />

        {/* Today's at-a-glance stats */}
        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Worked today</div>
            <div className="value">{duration(todayWorked)}</div>
            <div className="sub">{isOpen ? 'so far' : shift ? 'completed' : 'no shift yet'}</div>
          </div>

          <div className="stat">
            <div className="label">Break today</div>
            <div className="value">{duration(todayBreak)}</div>
            <div className="sub">
              of {duration(status.breakAllowanceSeconds ?? 3600)} allowance
            </div>
          </div>

          <div className="stat">
            <div className="label">Idle today</div>
            <div className="value">{duration(shift?.idleSeconds ?? 0)}</div>
            <div className="sub">no keyboard or mouse activity</div>
          </div>

          <div className="stat">
            <div className="label">Audio sampling</div>
            <div className="value" style={{ fontSize: 20 }}>
              {user.consent.audio ? 'On' : 'Off'}
            </div>
            <div className="sub">
              <Link href="/consent">Change this</Link>
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
                        <td className="num">{time(b.start, user.timezone)}</td>
                        <td className="num">
                          {b.end
                            ? time(b.end, user.timezone)
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
