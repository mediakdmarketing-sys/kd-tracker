import Link from 'next/link';
import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import { daysAgoDate, todayIn } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import PeopleScreenshots from '@/components/PeopleScreenshots';

export const metadata = { title: 'Screenshots · WorkBuddy' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 7; // the server's limit (backend/src/modules/admin/timesheet.service.js)

const spanDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

function rangeProblem(from, to) {
  if (from > to) return 'The From date is after the To date, so there is nothing to show. Put the earlier date in From.';
  const days = spanDays(from, to);
  if (days > MAX_DAYS) return `That is ${days} days. Screenshots are shown ${MAX_DAYS} days at a time: choose a shorter range.`;
  return null;
}

export default async function ScreenshotsPage({ searchParams }) {
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

  // The filters without dates and without the page, to build the quick date links and the paging.
  const people = new URLSearchParams();
  if (department) people.set('department', department);
  // A picked person is matched exactly; the typed text only applies when nobody was picked.
  if (employeeId) people.set('employeeId', employeeId);
  else if (employee) people.set('employee', employee);
  const withDates = (a, b) => `/admin/screenshots?${new URLSearchParams({ from: a, to: b, ...Object.fromEntries(people) })}`;
  const filters = new URLSearchParams({ from, to, ...Object.fromEntries(people) });

  const query = new URLSearchParams(filters);
  query.set('page', String(page));

  const [departments, options, shots] = await Promise.all([
    api('/api/admin/departments?inUse=1'),
    api('/api/admin/employee-options'),
    problem ? Promise.resolve(null) : api(`/api/admin/screenshots?${query}`),
  ]);
  const names = (departments || []).map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean);

  const yesterday = daysAgoDate(1, tz);
  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: yesterday, to: yesterday },
    { label: 'Last 7 days', from: daysAgoDate(6, tz), to: today },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Screenshots</h1>
          <p>
            Everyone’s screenshots in one place. Filter by date, by employee (search the list and pick a name), or by department. Each screenshot
            stays closed until you open it, and opening is recorded in the audit log. All times are New York time.
          </p>
        </div>
        <div className="btn-row">
          {presets.map((p) => (
            <Link
              key={p.label}
              className="btn"
              href={withDates(p.from, p.to)}
              style={p.from === from && p.to === to ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                { name: 'employee', label: 'Employee', type: 'employee', options: options || [] },
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

        {shots && (
          <>
            <div className="grid grid-stats">
              <div className="stat">
                <div className="label">People</div>
                <div className="value">{shots.pagination.total}</div>
                <div className="sub">with screenshots</div>
              </div>
              <div className="stat">
                <div className="label">Screenshots</div>
                <div className="value">{shots.images}</div>
                <div className="sub">{from === to ? from : `${from} to ${to}`}</div>
              </div>
              <div className="stat">
                <div className="label">On this page</div>
                <div className="value">{shots.people.length}</div>
                <div className="sub">page {page} of {shots.pagination.pages}</div>
              </div>
            </div>

            {shots.people.length > 1 && (
              <div className="card card-pad">
                <div className="faint" style={{ marginBottom: 8, fontSize: 13 }}>Jump to</div>
                <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {shots.people.map((p) => (
                    <a key={p.employeeId} href={`#shots-${p.employeeId}`} className="btn">
                      {p.name} <span className="faint">{p.images}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <PeopleScreenshots shots={shots} timezone={tz} page={page} pageHref={`/admin/screenshots?${filters}&`} />
          </>
        )}
      </div>
    </>
  );
}
