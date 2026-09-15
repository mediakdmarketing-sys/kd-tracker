import { Suspense, cache } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import CaptureSection from '@/components/CaptureSection';
import EmployeeActions from './EmployeeActions';
import LeaderActions from './LeaderActions';
import { duration, time, timeSec, dateLabel, todayIn, workedSecondsOf, isOpenShift } from '@/lib/format';
import { averageActivity } from '@/lib/activity';

/**
 * Fetch the employee record once per render pass and share the result between
 * generateMetadata and the page component. React's cache() deduplicates calls
 * with the same arguments within a single server request, so the backend only
 * receives one GET /api/admin/employees/:id regardless of how many places call
 * this function.
 */
const getEmployee = cache(async (id) => {
  return api(`/api/admin/employees/${id}`);
});

export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const employee = await getEmployee(id);
    return { title: `${employee.name} · WorkBuddy` };
  } catch {
    return { title: 'Employee · WorkBuddy' };
  }
}

export default async function EmployeeDetailPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;

  // requireUser and getEmployee are independent — run in parallel.
  // getEmployee hits the React cache, so generateMetadata's call above is reused.
  const [, employee] = await Promise.all([
    requireUser({ adminOnly: true }),
    getEmployee(id),
  ]);

  // Both default to today, same as the old single `date` param did — a range is opt-in, not
  // the new default. When from === to, everything below behaves exactly as it did before.
  const today = todayIn(employee.timezone);
  const from = query.from || query.date || today;
  const to = query.to || query.date || today;
  const isRange = from !== to;

  // Fetch attendance data + leader data in parallel with the four date-scoped calls.
  // activity limit is 200 (the API's max) rather than 1 — the average activity % needs the
  // real rows, not just the pagination total. A 9h shift tops out around 540 one-minute
  // windows in principle, but idle windows send no row at all, so 200 comfortably covers a
  // realistically active day; pagination.total still reflects the true count either way.
  // Project-time summary stays single-day (the backend endpoint isn't range-aware yet) —
  // fetched only when it can actually be shown, rather than a call whose result is discarded.
  const [attendance, screenshots, audio, activity, allDepts, leaderAssignments, agentConfig, projectTime] =
    await Promise.all([
      api(`/api/attendance/${id}?from=${from}&to=${to}`),
      api(`/api/screenshots/${id}?from=${from}&to=${to}&limit=200`),
      api(`/api/audio/${id}?from=${from}&to=${to}&limit=60`),
      api(`/api/activity/${id}?from=${from}&to=${to}&limit=200`),
      api('/api/admin/departments'),
      api('/api/admin/department-leaders'),
      api('/api/config'),
      isRange ? Promise.resolve([]) : api(`/api/attendance/${id}/projects?date=${from}`),
    ]);

  // Departments this employee currently leads.
  const currentLeaderDepts = leaderAssignments
    .filter((a) => a.employeeId === id)
    .map((a) => a.department);

  // A range can contain several shifts; a single day has at most one open + one closed. Sum
  // across all of them for the range case rather than showing only the first (which is what
  // silently happened before screenshots/audio even supported a range).
  const shift = isRange ? null : attendance.data[0];
  const isOpen = isOpenShift(shift);
  const rangeWorkedSeconds = attendance.data.reduce((sum, s) => sum + workedSecondsOf(s), 0);
  const workedSeconds = isRange ? rangeWorkedSeconds : workedSecondsOf(shift);
  const avgActivity   = averageActivity(activity.data);
  const overtimeSeconds = isRange ? 0 : Math.max(0, workedSeconds - agentConfig.shift.targetSeconds);
  const isOvertime      = overtimeSeconds > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{employee.name}</h1>
          <p>
            {employee.email}
            {employee.department ? ` · ${employee.department}` : ''}{' '}
            <Link href="/admin/employees" className="btn" style={{ marginLeft: 8 }}>
              ← All employees
            </Link>
          </p>
        </div>
        <EmployeeActions employee={employee} departments={allDepts} />
      </div>

      <div className="stack">
        <div className="notice notice-info">
          <strong>This page is audited.</strong> Opening a screenshot or an audio sample
          records your name, the employee, and the time in the audit log. Listing them
          does too.
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
                ? `${time(shift.punchIn, employee.timezone)} – ${time(shift.punchOut, employee.timezone)}`
                : '—'}
            </div>
            <div className="sub">
              {isRange ? 'in this range' : shift ? shift.status : 'no shift'}
              {!isRange && shift?.source === 'queued' && (
                <span className="pill pill-idle" style={{ marginLeft: 6 }}>
                  Queued · reached us {time(shift.punchInReceivedAt, employee.timezone)}
                </span>
              )}
            </div>
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
            <div className="sub">
              {activity.pagination.total} ping{activity.pagination.total === 1 ? '' : 's'} · counts only, never content
            </div>
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
            <div className="card-head">
              <h2>Breaks</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>End</th>
                    <th>Length</th>
                  </tr>
                </thead>
                <tbody>
                  {shift.breaks.map((b) => (
                    <tr key={b.id}>
                      <td className="num">{timeSec(b.start, employee.timezone)}</td>
                      <td className="num">
                        {b.end ? timeSec(b.end, employee.timezone) : 'running'}
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
          timezone={employee.timezone}
          from={from}
          to={to}
          consentAudio={employee.consent.audio}
          showConsentColumn
          subjectLabel="employee"
          blurScreenshots={employee.blurScreenshots}
        />

        {/* Leader management — assign/remove this employee as dept leader */}
        <LeaderActions
          employee={employee}
          departments={allDepts}
          currentLeaderDepts={currentLeaderDepts}
        />
      </div>
    </>
  );
}
