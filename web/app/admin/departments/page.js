import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import CreateDepartmentForm from './CreateDepartmentForm';
import DeleteDepartmentButton from './DeleteDepartmentButton';

export const metadata = { title: 'Departments · KD Tracker' };

export default async function DepartmentsPage() {
  const [, departments, leaders] = await Promise.all([
    requireUser({ adminOnly: true }),
    api('/api/admin/departments/full'),
    api('/api/admin/department-leaders'),
  ]);

  const byDept = leaders.reduce((acc, l) => {
    (acc[l.department] ||= []).push(l);
    return acc;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Departments</h1>
          <p>Create departments and assign leaders.</p>
        </div>
      </div>

      <div className="stack">
        <CreateDepartmentForm />

        {departments.length === 0 ? (
          <div className="card">
            <div className="empty">No departments yet. Create one above.</div>
          </div>
        ) : (
          departments.map((dept) => {
            const deptLeaders = byDept[dept.name] || [];
            return (
              <div key={dept.id} className="card">
                <div className="card-head">
                  <div>
                    <h2>{dept.name}</h2>
                    {dept.description && (
                      <div className="faint" style={{ fontSize: 13, marginTop: 2 }}>
                        {dept.description}
                      </div>
                    )}
                  </div>
                  <div className="inline">
                    <span className="faint">
                      {deptLeaders.length === 0
                        ? 'No leaders'
                        : `${deptLeaders.length} leader${deptLeaders.length === 1 ? '' : 's'}`}
                    </span>
                    <DeleteDepartmentButton id={dept.id} name={dept.name} />
                  </div>
                </div>

                {deptLeaders.length === 0 ? (
                  <div className="empty" style={{ padding: '14px 18px' }}>
                    No leader assigned.{' '}
                    <Link href="/admin/employees">Go to an employee</Link> to assign one.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th>Assigned</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptLeaders.map((l) => (
                          <tr key={l.employeeId}>
                            <td>
                              {l.name}
                              <div className="faint" style={{ fontSize: 12 }}>{l.email}</div>
                            </td>
                            <td>
                              <span className={`pill ${l.status === 'active' ? 'pill-working' : 'pill-out'}`}>
                                {l.status}
                              </span>
                            </td>
                            <td className="faint num" style={{ fontSize: 12 }}>
                              {l.assignedAt
                                ? new Date(l.assignedAt).toLocaleDateString('en-GB')
                                : '—'}
                            </td>
                            <td>
                              <Link
                                href={`/admin/employees/${l.employeeId}`}
                                className="btn"
                              >
                                Manage →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
