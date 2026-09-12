import { Suspense, cache } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import CaptureSection from '@/components/CaptureSection';
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

        <CaptureSection
          screenshots={screenshots.data}
          audio={audio.data}
          timezone={member.timezone}
          date={date}
          buildScreenshotUrl={(image) => `/bff/api/leader/members/${id}/screenshots/file/${image.id}`}
          buildAudioUrl={(sample) => `/bff/api/leader/members/${id}/audio/file/${sample.id}`}
          consentAudio={member.consent?.audio}
          subjectLabel="member"
        />
      </div>
    </>
  );
}
