import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import ShiftPanel from '@/components/ShiftPanel';
import ShiftStats from '@/components/ShiftStats';
import { duration, time, timeSec, breakSecondsOf, isOpenShift } from '@/lib/format';

export const metadata = { title: 'My shift · WorkBuddy' };

export default async function MyShiftPage() {
  const [user, status] = await Promise.all([
    requireUser(),
    api('/api/attendance/status'),
  ]);

  const agentDownloadUrl = process.env.AGENT_DOWNLOAD_URL || '';
  const shift   = status.shift ?? null;
  const isOpen  = isOpenShift(shift);
  const punched = status.state !== 'punched_out';

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
        {agentDownloadUrl && (
          <div className="notice" style={{ fontSize: 13 }}>
            Screenshots and activity come from the WorkBuddy desktop agent. Not installed yet?{' '}
            <a href={agentDownloadUrl} download>
              <strong>Download it here</strong>
            </a>{' '}
            (see <Link href="/help#agent-install">install steps</Link>).
          </div>
        )}

        {/* Live punch controls + ticking clock */}
        <ShiftPanel initial={status} timezone={user.timezone} />

        {/* Today's at-a-glance stats */}
        {/* Shares ShiftPanel's live status, so the tiles and the clock above never disagree. */}
        <ShiftStats initial={status} fallbackBreakSeconds={todayBreak} />

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
