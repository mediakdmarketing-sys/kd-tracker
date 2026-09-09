import { Suspense, cache } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import ScreenshotGrid from '@/components/ScreenshotGrid';
import { duration, time, dateLabel, todayIn, workedSecondsOf, isOpenShift } from '@/lib/format';

export const metadata = { title: 'Member detail · KD Tracker' };

// Deduplicated member info fetch — uses the leader-accessible endpoint, not the admin one.
const getMember = cache(async (id) => api(`/api/leader/members/${id}/info`));

export default async function LeaderMemberDetailPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;

  const [user, member] = await Promise.all([
    requireUser(),
    getMember(id),
  ]);

  const date = query.date || todayIn(member.timezone);

  const [attendance, screenshots, audio] = await Promise.all([
    api(`/api/leader/members/${id}/attendance?from=${date}&to=${date}`),
    api(`/api/leader/members/${id}/screenshots?date=${date}&limit=200`),
    api(`/api/leader/members/${id}/audio?date=${date}&limit=60`),
  ]);

  const shift = attendance.data[0];
  const isOpen = isOpenShift(shift);
  const workedSeconds = workedSecondsOf(shift);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{member.name}</h1>
          <p>
            {member.email}
            {member.department ? ` · ${member.department}` : ''}{' '}
            <Link href="/leader/members" className="btn" style={{ marginLeft: 8 }}>
              ← Back to team
            </Link>
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="notice notice-info">
          <strong>This page is audited.</strong> Opening a screenshot or audio sample records
          your name, the member, and the time in the audit log.
        </div>

        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[{ name: 'date', label: 'Date', type: 'date', defaultValue: date }]}
            />
          </Suspense>
        </div>

        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Worked</div>
            <div className="value">{duration(workedSeconds)}</div>
            <div className="sub">{dateLabel(date)}{isOpen ? ' · so far' : ''}</div>
          </div>
          <div className="stat">
            <div className="label">Punch in / out</div>
            <div className="value" style={{ fontSize: 20 }}>
              {shift
                ? `${time(shift.punchIn, member.timezone)} – ${time(shift.punchOut, member.timezone)}`
                : '—'}
            </div>
            <div className="sub">{shift ? shift.status : 'no shift'}</div>
          </div>
          <div className="stat">
            <div className="label">Break</div>
            <div className="value">{duration(shift?.totalBreakSeconds)}</div>
            <div className="sub">
              {shift?.overBreak ? 'over the allowance' : 'within allowance'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Idle</div>
            <div className="value">{duration(shift?.idleSeconds)}</div>
          </div>
        </div>

        {shift?.needsReview && (
          <div className="notice notice-warn">
            <strong>Flagged for review.</strong> {shift.reviewReason}
          </div>
        )}

        {shift?.breaks?.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Breaks</h2></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Start</th><th>End</th><th>Length</th></tr>
                </thead>
                <tbody>
                  {shift.breaks.map((b) => (
                    <tr key={b.id}>
                      <td className="num">{time(b.start, member.timezone)}</td>
                      <td className="num">
                        {b.end ? time(b.end, member.timezone) : 'running'}
                      </td>
                      <td className="num">{duration(b.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Screenshots — routed through leader-scoped BFF path */}
        <ScreenshotGrid
          items={screenshots.data}
          timezone={member.timezone}
          date={date}
          buildFileUrl={(image) => `/bff/api/leader/members/${id}/screenshots/file/${image.id}`}
        />

        {/* Audio recordings */}
        <div className="card">
          <div className="card-head">
            <h2>Audio samples</h2>
            <span className="faint">
              {member.consent?.audio ? 'Audio consent given' : 'Audio consent not given'}
            </span>
          </div>
          {audio.data.length === 0 ? (
            <div className="empty">
              {member.consent?.audio
                ? 'No audio samples recorded on this date.'
                : 'This member has not consented to audio sampling.'}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Recorded</th><th>Length</th><th>Mic</th><th>File</th></tr>
                </thead>
                <tbody>
                  {audio.data.map((sample) => (
                    <tr key={sample.id}>
                      <td className="num">{time(sample.recordedAt, member.timezone)}</td>
                      <td className="num">{duration(sample.durationSeconds)}</td>
                      <td>
                        {sample.micMuted === true ? (
                          <span className="pill pill-flag" title="Mic was muted">Muted</span>
                        ) : sample.micMuted === false ? (
                          <span className="pill pill-working">Live</span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        {sample.fileDeleted ? (
                          <span className="faint">Deleted after 31 days</span>
                        ) : (
                          <audio
                            controls
                            preload="none"
                            src={`/bff/api/leader/members/${id}/audio/file/${sample.id}`}
                            style={{ height: 32 }}
                          />
                        )}
                      </td>
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
