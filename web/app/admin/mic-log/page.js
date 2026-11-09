import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import MicLogTable from '@/components/MicLogTable';
import RangeFilter from '@/components/RangeFilter';
import { daysAgoDate, todayIn } from '@/lib/format';

export const metadata = { title: 'Mic log · WorkBuddy' };

const MAX_RANGE_DAYS = 93; // the server's limit (backend/src/modules/capture/micLog.js)
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What is wrong with the chosen dates, in words, or null. A crafted link can still get here. */
function rangeProblem(from, to) {
  if (!DATE.test(from) || !DATE.test(to)) return 'Choose a real From and To date.';
  if (from > to) return 'The From date is after the To date, so there is nothing to show. Put the earlier date in From.';
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return `That is ${days} days. Choose a range of ${MAX_RANGE_DAYS} days or less.`;
  return null;
}

export default async function MicLogPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const from = params.from || daysAgoDate(6, user.timezone);
  const to = params.to || todayIn(user.timezone);
  const department = params.department || '';
  const problem = rangeProblem(from, to);

  const query = new URLSearchParams({ from, to });
  if (department) query.set('department', department);

  const [log, departments] = await Promise.all([
    problem ? Promise.resolve(null) : api(`/api/admin/mic-log?${query}`),
    api('/api/admin/departments'),
  ]);

  const names = (departments || []).map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mic log</h1>
          <p>
            When an employee’s microphone was found muted, from what time to what time. Worked out
            from the audio samples (one about every 13 minutes), so each time is a sample time, not
            to the second. All times are New York time.
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

        {problem ? (
          <div className="notice notice-warn" role="alert">{problem}</div>
        ) : (
          <div className="card">
            <div className="card-head">
              <h2>{log.periods.length} muted period{log.periods.length === 1 ? '' : 's'}</h2>
              <span className="faint">{log.from === log.to ? log.from : `${log.from} to ${log.to}`}</span>
            </div>
            <MicLogTable periods={log.periods} timezone={user.timezone} showEmployee />
          </div>
        )}
      </div>
    </>
  );
}
