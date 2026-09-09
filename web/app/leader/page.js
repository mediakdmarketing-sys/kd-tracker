import Link from 'next/link';
import { api, requireUser } from '@/lib/api';

export const metadata = { title: 'My team · KD Tracker' };

export default async function LeaderIndexPage() {
  const [user, departments] = await Promise.all([
    requireUser(),
    api('/api/leader/departments'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My team</h1>
          <p>Departments you lead and their members.</p>
        </div>
        <Link href="/leader/members" className="btn btn-primary">
          Live board →
        </Link>
      </div>

      <div className="stack">
        {departments.length === 0 ? (
          <div className="card">
            <div className="empty">
              You have not been assigned as a leader of any department yet. Contact HR.
            </div>
          </div>
        ) : (
          departments.map((dept) => (
            <div key={dept.department} className="card">
              <div className="card-head">
                <div>
                  <h2>{dept.department}</h2>
                  <span className="faint">
                    {dept.memberCount} member{dept.memberCount === 1 ? '' : 's'}
                    {dept.liveCount > 0
                      ? ` · ${dept.liveCount} working now`
                      : ''}
                  </span>
                </div>
                <Link
                  href={`/leader/members?department=${encodeURIComponent(dept.department)}`}
                  className="btn"
                >
                  View live →
                </Link>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dept.members.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td className="faint">{m.email}</td>
                        <td>
                          <span className={`pill ${m.role === 'leader' ? 'pill-break' : 'pill-out'}`}>
                            {m.role === 'leader' ? 'Leader' : 'Member'}
                          </span>
                        </td>
                        <td>
                          <Link href={`/leader/members/${m.id}`} className="btn">
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
