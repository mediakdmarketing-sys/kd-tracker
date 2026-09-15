import { Suspense, cache } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import CaptureSection from '@/components/CaptureSection';
import { duration, time, timeSec, dateLabel, todayIn, workedSecondsOf, isOpenShift } from '@/lib/format';
import { averageActivity } from '@/lib/activity';

export const metadata = { title: 'Member detail · WorkBuddy' };

// Deduplicated member info fetch — uses the leader-accessible endpoint, not the admin one.
const getMember = cache(async (id) => api(`/api/leader/members/${id}/info`));

export default async function LeaderMemberDetailPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;

  const [user, member] = await Promise.all([
    requireUser(),
    getMember(id),
  ]);

  const today = todayIn(member.timezone);
  const from = query.from || query.date || today;
  const to = query.to || query.date || today;
  const isRange = from !== to;

  const [attendance, screenshots, audio, activity, agentConfig, projectTime] = await Promise.all([
    api(`/api/leader/members/${id}/attendance?from=${from}&to=${to}`),
    api(`/api/leader/members/${id}/screenshots?from=${from}&to=${to}&limit=200`),
    api(`/api/leader/members/${id}/audio?from=${from}&to=${to}&limit=60`),
    api(`/api/leader/members/${id}/activity?from=${from}&to=${to}&limit=200`),
    api('/api/config'),
    isRange ? Promise.resolve([]) : api(`/api/leader/members/${id}/projects?date=${from}`),
  ]);

  const shift = isRange ? null : attendance.data[0];
  const isOpen = isOpenShift(shift);
  const rangeWorkedSeconds = attendance.data.reduce((sum, s) => sum + workedSecondsOf(s), 0);
  const workedSeconds   = isRange ? rangeWorkedSeconds : workedSecondsOf(shift);
  const avgActivity     = averageActivity(activity.data);
  const overtimeSeconds = isRange ? 0 : Math.max(0, workedSeconds - agentConfig.shift.targetSeconds);
  const isOvertime      = overtimeSeconds > 0;

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
            <div className="value">
              {duration(workedSeconds)}
              {isOvertime && (
                <span className="pill pill-flag" style={{ marginLeft: 8, fontSize: 12 }}>
                  +{duration(overtimeSeconds)} over
                </span>
              )}
            </div>
            <div className="sub">
              {isRange
                ? `${dateLabel(from)} – ${dateLabel(to)}`
                : `${dateLabel(from)}${isOpen ? ' · so far' : ''}`}
            </div>
          </div>
          <div className="stat">
            <div className="label">{isRange ? 'Shifts' : 'Punch in / out'}</div>
            <div className="value" style={{ fontSize: isRange ? 26 : 20 }}>
              {isRange
                ? attendance.data.length
                : shift
                ? `${time(shift.punchIn, member.timezone)} – ${time(shift.punchOut, member.timezone)}`
                : '—'}
            </div>
            <div className="sub">{isRange ? 'in this range' : shift ? shift.status : 'no shift'}</div>
          </div>
          <div className="stat">
            <div className="label">Break</div>
            <div className="value">
              {duration(
                isRange
                  ? attendance.data.reduce((sum, s) => sum + (s.totalBreakSeconds || 0), 0)
                  : shift?.totalBreakSeconds
              )}
            </div>
            <div className="sub">
              {isRange
                ? 'total across range'
                : shift?.overBreak
                ? 'over the allowance'
                : 'within allowance'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Idle</div>
            <div className="value">
              {duration(
                isRange
                  ? attendance.data.reduce((sum, s) => sum + (s.idleSeconds || 0), 0)
                  : shift?.idleSeconds
              )}
            </div>
          </div>
          <div className="stat">
            <div className="label">Activity</div>
            <div className="value">{avgActivity === null ? '—' : `${avgActivity}%`}</div>
            <div className="sub">counts only, never content</div>
          </div>
        </div>

        {isOvertime && (
          <div className="notice notice-warn">
            <strong>Over target.</strong> Worked {duration(overtimeSeconds)} beyond the
            {' '}{duration(agentConfig.shift.targetSeconds)} shift target.
          </div>
        )}

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
                      <td className="num">{timeSec(b.start, member.timezone)}</td>
                      <td className="num">
                        {b.end ? timeSec(b.end, member.timezone) : 'running'}
                      </td>
                      <td className="num">{duration(b.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {projectTime.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>Time by project</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {projectTime.map((row) => (
                    <tr key={row.projectId || 'unassigned'}>
                      <td className={row.projectId ? undefined : 'muted'}>{row.projectName}</td>
                      <td className="num">{duration(row.seconds)}</td>
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
          from={from}
          to={to}
          screenshotUrlBase={`/bff/api/leader/members/${id}/screenshots/file`}
          audioUrlBase={`/bff/api/leader/members/${id}/audio/file`}
          consentAudio={member.consent?.audio}
          subjectLabel="member"
          blurScreenshots={member.blurScreenshots}
        />
      </div>
    </>
  );
}
