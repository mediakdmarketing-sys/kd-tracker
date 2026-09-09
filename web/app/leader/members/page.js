import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import { duration, time, STATE_LABEL, STATE_CLASS } from '@/lib/format';

export const metadata = { title: 'Team live board · KD Tracker' };

export default async function LeaderMembersPage({ searchParams }) {
  const params = await searchParams;
  const [user, data] = await Promise.all([
    requireUser(),
    api('/api/leader/members'),
  ]);

  const filterDept = params.department || '';
  const rows = filterDept
    ? data.employees.filter((e) => e.department === filterDept)
    : data.employees;

  const { summary } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team live board</h1>
          <p>Real-time status of your department members.</p>
        </div>
        <Link href="/leader" className="btn">← My team</Link>
      </div>

      <div className="stack">
        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Working</div>
            <div className="value" style={{ color: 'var(--ok)' }}>{summary.working}</div>
          </div>
          <div className="stat">
            <div className="label">On break</div>
            <div className="value" style={{ color: 'var(--warn)' }}>{summary.onBreak}</div>
          </div>
          <div className="stat">
            <div className="label">Punched out</div>
            <div className="value">{summary.punchedOut}</div>
          </div>
          <div className="stat">
            <div className="label">Not started</div>
            <div className="value">{summary.notStarted}</div>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>State</th>
                  <th>In</th>
                  <th>Worked</th>
                  <th>Break</th>
                  <th>Last activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">No members found.</div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        <div>{row.name}</div>
                        <div className="faint">{row.email}</div>
                      </td>
                      <td className="muted">{row.department || '—'}</td>
                      <td>
                        <div className="inline">
                          <span className={`pill ${STATE_CLASS[row.state]}`}>
                            {STATE_LABEL[row.state]}
                          </span>
                          {row.appearsIdle && (
                            <span className="pill pill-idle">Idle</span>
                          )}
                          {row.needsReview && (
                            <span className="pill pill-flag">Review</span>
                          )}
                        </div>
                      </td>
                      <td className="num">{row.punchIn ? time(row.punchIn, user.timezone) : '—'}</td>
                      <td className="num">{duration(row.workedSeconds)}</td>
                      <td className="num">
                        <span className={row.overBreak ? 'pill pill-flag' : undefined}>
                          {duration(row.breakSeconds)}
                        </span>
                      </td>
                      <td className="num muted">
                        {row.lastActivityAt ? time(row.lastActivityAt, user.timezone) : '—'}
                      </td>
                      <td>
                        <Link href={`/leader/members/${row.employeeId}`} className="btn">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
