import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import { todayIn } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import LiveTimesheet from '../../admin/timesheet/LiveTimesheet';

export const metadata = { title: 'Team timesheet · WorkInvigilator' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 31; // the server's limit (backend/src/modules/admin/timesheet.service.js)

const spanDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

/** A leader's timesheet: the hours of the people in the departments they lead. */
export default async function LeaderTimesheetPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser();
  const tz = user.timezone;

  const today = todayIn(tz);
  const from = DATE.test(params.from || '') ? params.from : DATE.test(params.to || '') ? params.to : today;
  const to = DATE.test(params.to || '') ? params.to : from;
  const department = params.department || '';
  const employee = (params.employee || '').trim();
  const employeeId = UUID.test(params.employeeId || '') ? params.employeeId : '';

  const problem =
    from > to
      ? 'The From date is after the To date, so there is nothing to show. Put the earlier date in From.'
      : spanDays(from, to) > MAX_DAYS
      ? `That is ${spanDays(from, to)} days. Choose a range of ${MAX_DAYS} days or less.`
      : null;

  const filters = new URLSearchParams({ from, to });
  if (department) filters.set('department', department);
  // A person picked from the list is matched exactly; typed text only applies when nobody was picked.
  if (employeeId) filters.set('employeeId', employeeId);
  else if (employee) filters.set('employee', employee);

  const [teams, sheet] = await Promise.all([
    api('/api/leader/departments'),
    problem ? Promise.resolve(null) : api(`/api/leader/timesheet?${filters}`),
  ]);

  // Only this leader's own departments and people are offered in the filters.
  const names = (teams || []).map((d) => d.department).filter(Boolean);
  const people = (teams || []).flatMap((d) =>
    // Not the leader themselves: a leader's own record is not part of their team's timesheet.
    (d.members || []).filter((m) => m.id !== user.id).map((m) => ({ id: m.id, name: m.name, department: d.department, active: true }))
  );

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>Team timesheet</h1>
          <p>
            Your team’s hours live, for the day or days you pick: who is working, on a break or has not started, their
            time in and out, breaks and idle time. All times are New York time.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad no-print">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                { name: 'employee', label: 'Employee', type: 'employee', options: people },
                {
                  name: 'department',
                  label: 'Department',
                  type: 'select',
                  options: [{ value: '', label: 'All my departments' }, ...names.map((n) => ({ value: n, label: n }))],
                },
              ]}
            />
          </Suspense>
        </div>

        {problem && <div className="notice notice-warn no-print" role="alert">{problem}</div>}

        {sheet && <LiveTimesheet initial={sheet} query={filters.toString()} timezone={tz} scope="leader" />}
      </div>
    </>
  );
}
