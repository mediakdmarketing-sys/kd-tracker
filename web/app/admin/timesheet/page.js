import Link from 'next/link';
import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import { todayIn } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import PeopleScreenshots from '@/components/PeopleScreenshots';
import LiveTimesheet from './LiveTimesheet';

export const metadata = { title: 'Timesheet · WorkInvigilator' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIMESHEET_DAYS = 31; // the server's limits (backend/src/modules/admin/timesheet.service.js)
const MAX_SCREENSHOT_DAYS = 7;

const spanDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

function rangeProblem(from, to) {
  if (from > to) return 'The From date is after the To date, so there is nothing to show. Put the earlier date in From.';
  const days = spanDays(from, to);
  if (days > MAX_TIMESHEET_DAYS) return `That is ${days} days. Choose a range of ${MAX_TIMESHEET_DAYS} days or less.`;
  return null;
}

export default async function TimesheetPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });
  const tz = user.timezone;

  const today = todayIn(tz);
  const from = DATE.test(params.from || '') ? params.from : DATE.test(params.to || '') ? params.to : today;
  const to = DATE.test(params.to || '') ? params.to : from;
  const department = params.department || '';
  const employee = (params.employee || '').trim();
  const employeeId = UUID.test(params.employeeId || '') ? params.employeeId : '';
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);

  const problem = rangeProblem(from, to);
  const shotsAllowed = !problem && spanDays(from, to) <= MAX_SCREENSHOT_DAYS;

  const filters = new URLSearchParams({ from, to });
  if (department) filters.set('department', department);
  // A picked person is matched exactly; the typed text only applies when nobody was picked.
  if (employeeId) filters.set('employeeId', employeeId);
  else if (employee) filters.set('employee', employee);
  const shotQuery = new URLSearchParams(filters);
  shotQuery.set('page', String(page));

  const [departments, people, sheet, shots] = await Promise.all([
    api('/api/admin/departments?inUse=1'),
    api('/api/admin/employee-options'),
    problem ? Promise.resolve(null) : api(`/api/admin/timesheet?${filters}`),
    shotsAllowed ? api(`/api/admin/screenshots?${shotQuery}`) : Promise.resolve(null),
  ]);

  const names = (departments || []).map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timesheet</h1>
          <p>
            Everyone’s hours live, and everyone’s screenshots, for the day or days you pick. Filter by date, by employee
            (search the list and pick a name), or by department. All times are New York time.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                { name: 'employee', label: 'Employee', type: 'employee', options: people || [] },
                {
                  name: 'department',
                  label: 'Department',
                  type: 'select',
                  options: [{ value: '', label: 'Everyone' }, ...names.map((n) => ({ value: n, label: n }))],
                },
              ]}
            />
          </Suspense>
        </div>

        {problem && <div className="notice notice-warn" role="alert">{problem}</div>}

        {sheet && <LiveTimesheet initial={sheet} query={filters.toString()} timezone={tz} />}

        {sheet && !shotsAllowed && (
          <div className="notice notice-info">
            Screenshots are shown for up to {MAX_SCREENSHOT_DAYS} days at a time. Choose a shorter range to see them.
          </div>
        )}

        {shots && (
          <>
            <div className="card">
              <div className="card-head">
                <h2>Screenshots</h2>
                <span className="faint">
                  {shots.pagination.total} {shots.pagination.total === 1 ? 'person has' : 'people have'} screenshots in this
                  range. Each stays closed until you open it, and opening is recorded in the audit log.
                </span>
              </div>
              <div className="card-pad" style={{ paddingTop: 0 }}>
                <Link href={`/admin/screenshots?${filters}`}>Open these in the Screenshots page</Link>
              </div>
            </div>

            <PeopleScreenshots shots={shots} timezone={tz} page={page} pageHref={`/admin/timesheet?${filters}&`} />
          </>
        )}
      </div>
    </>
  );
}
