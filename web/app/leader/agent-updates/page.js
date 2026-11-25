import { api, requireUser } from '@/lib/api';
import AgentUpdatesTable from '@/components/AgentUpdatesTable';

export const metadata = { title: 'Agent updates · WorkInvigilator' };

/** A team leader's view: who in their team has installed the newest desktop agent. */
export default async function LeaderAgentUpdatesPage() {
  const [user, data] = await Promise.all([requireUser(), api('/api/leader/agent-updates')]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agent updates</h1>
          <p>
            Who in your team has installed the newest desktop agent. Remind the ones marked “Not updated” to press
            Update when the window appears (or open the agent from the tray icon).
          </p>
        </div>
      </div>
      <div className="stack">
        <AgentUpdatesTable data={data} timezone={user.timezone} scope="leader" />
      </div>
    </>
  );
}
