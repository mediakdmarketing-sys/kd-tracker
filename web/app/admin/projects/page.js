import { api, requireUser } from '@/lib/api';
import CreateProjectForm from './CreateProjectForm';
import ProjectArchiveButton from './ProjectArchiveButton';

export const metadata = { title: 'Projects · WorkBuddy' };

export default async function ProjectsPage() {
  const [, projects, departments] = await Promise.all([
    requireUser({ adminOnly: true }),
    api('/api/admin/projects'),
    api('/api/admin/departments'),
  ]);

  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>
            What hours get attributed to. Employees pick one from their shift once it exists
            here — archiving hides it from that picker without touching past time entries.
          </p>
        </div>
      </div>

      <div className="stack">
        <CreateProjectForm departments={departments} />

        <div className="card">
          <div className="card-head">
            <h2>Active</h2>
            <span className="faint">{active.length}</span>
          </div>
          {active.length === 0 ? (
            <div className="empty">No active projects yet. Create one above.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Client</th>
                    <th>Department</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="muted">{p.client || '—'}</td>
                      <td className="muted">{p.department || 'Every department'}</td>
                      <td><ProjectArchiveButton project={p} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {archived.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>Archived</h2>
              <span className="faint">{archived.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Client</th>
                    <th>Department</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {archived.map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{p.name}</td>
                      <td className="muted">{p.client || '—'}</td>
                      <td className="muted">{p.department || 'Every department'}</td>
                      <td><ProjectArchiveButton project={p} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
