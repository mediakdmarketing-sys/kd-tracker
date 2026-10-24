import { api, requireUser } from '@/lib/api';
import MicLogTable from '@/components/MicLogTable';
import { daysAgoDate, todayIn } from '@/lib/format';

export const metadata = { title: 'Mic log · WorkBuddy' };

export default async function MicLogPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const from = params.from || daysAgoDate(6, user.timezone);
  const to = params.to || todayIn(user.timezone);
  const department = params.department || '';

  const query = new URLSearchParams({ from, to });
  if (department) query.set('department', department);

  const [log, departments] = await Promise.all([
    api(`/api/admin/mic-log?${query}`),
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
        <form method="get" className="card card-pad">
          <div className="inline" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="from">From</label>
              <input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div>
              <label htmlFor="to">To</label>
              <input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <div>
              <label htmlFor="department">Department</label>
              <select id="department" name="department" defaultValue={department}>
                <option value="">Everyone</option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              Show
            </button>
          </div>
        </form>

        <div className="card">
          <div className="card-head">
            <h2>{log.periods.length} muted period{log.periods.length === 1 ? '' : 's'}</h2>
          </div>
          <MicLogTable periods={log.periods} timezone={user.timezone} showEmployee />
        </div>
      </div>
    </>
  );
}
