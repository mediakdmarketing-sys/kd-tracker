import { Suspense, cache } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import CaptureSection from '@/components/CaptureSection';
import EmployeeActions from './EmployeeActions';
import LeaderActions from './LeaderActions';
import { duration, time, dateLabel, todayIn, workedSecondsOf, isOpenShift } from '@/lib/format';

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
    return { title: `${employee.name} · KD Tracker` };
  } catch {
    return { title: 'Employee · KD Tracker' };
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

  const date = query.date || todayIn(employee.timezone);

  // Fetch attendance data + leader data in parallel with the four date-scoped calls.
  const [attendance, screenshots, audio, activity, allDepts, leaderAssignments] = await Promise.all([
    api(`/api/attendance/${id}?from=${date}&to=${date}`),
    api(`/api/screenshots/${id}?date=${date}&limit=200`),
    api(`/api/audio/${id}?date=${date}&limit=60`),
    api(`/api/activity/${id}?from=${date}&to=${date}&limit=1`),
    api('/api/admin/departments'),
    api('/api/admin/department-leaders'),
  ]);

  // Departments this employee currently leads.
  const currentLeaderDepts = leaderAssignments
    .filter((a) => a.employeeId === id)
    .map((a) => a.department);

  const shift        = attendance.data[0];
  const isOpen       = isOpenShift(shift);
  const workedSeconds = workedSecondsOf(shift);

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
              fields={[{ name: 'date', label: 'Date', type: 'date', defaultValue: date }]}
            />
          </Suspense>
        </div>

        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Worked</div>
            <div className="value">{duration(workedSeconds)}</div>
            <div className="sub">
              {dateLabel(date)}{isOpen ? ' · so far' : ''}
            </div>
          </div>

          <div className="stat">
            <div className="label">Punch in / out</div>
            <div className="value" style={{ fontSize: 20 }}>
              {shift
                ? `${time(shift.punchIn, employee.timezone)} – ${time(shift.punchOut, employee.timezone)}`
                : '—'}
            </div>
            <div className="sub">
              {shift ? shift.status : 'no shift'}
              {shift?.source === 'queued' && (
                <span className="pill pill-idle" style={{ marginLeft: 6 }}>
                  Queued · reached us {time(shift.punchInReceivedAt, employee.timezone)}
                </span>
              )}
            </div>
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

          <div className="stat">
            <div className="label">Activity pings</div>
            <div className="value">{activity.pagination.total}</div>
            <div className="sub">counts only, never content</div>
          </div>
        </div>

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
                      <td className="num">{time(b.start, employee.timezone)}</td>
                      <td className="num">
                        {b.end ? time(b.end, employee.timezone) : 'running'}
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
          timezone={employee.timezone}
          date={date}
          buildAudioUrl={(sample) => `/bff${sample.fileUrl}`}
          consentAudio={employee.consent.audio}
          showConsentColumn
          subjectLabel="employee"
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
