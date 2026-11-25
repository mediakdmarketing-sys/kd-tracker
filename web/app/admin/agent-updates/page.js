import { api, requireUser } from '@/lib/api';
import AgentUpdatesTable from '@/components/AgentUpdatesTable';
import PublishReleaseForm from './PublishReleaseForm';

export const metadata = { title: 'Agent updates · WorkInvigilator' };

export default async function AgentUpdatesPage() {
  const [user, data] = await Promise.all([requireUser({ adminOnly: true }), api('/api/admin/agent-updates')]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agent updates</h1>
          <p>
            Publish a new version of the desktop agent and see who has installed it. Agents offer the update in a
            window with what is new; pressing Update replaces the old copy with the new one.
          </p>
        </div>
      </div>

      <div className="stack">
        <PublishReleaseForm newest={data.release?.version || null} />
        <AgentUpdatesTable data={data} timezone={user.timezone} scope="admin" />

        {data.history.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Releases</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Version</th><th>What is new</th><th>Required</th></tr></thead>
                <tbody>
                  {data.history.map((r) => (
                    <tr key={r.id}>
                      <td className="num"><strong>{r.version}</strong></td>
                      <td className="muted">{r.notes.join(' · ')}</td>
                      <td>{r.mandatory ? <span className="pill pill-flag">Required</span> : <span className="faint">No</span>}</td>
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
