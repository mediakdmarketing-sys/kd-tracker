import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import LeaderLiveBoard from '@/components/LeaderLiveBoard';

export const metadata = { title: 'Team live board · WorkInvigilator' };

export default async function LeaderMembersPage() {
  const [user, data, agentConfig] = await Promise.all([
    requireUser(),
    api('/api/leader/members'),
    api('/api/config'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team live board</h1>
          <p>Real-time status of your department members.</p>
        </div>
        <Link href="/leader" className="btn">← My team</Link>
      </div>

      <LeaderLiveBoard
        initial={data}
        timezone={user.timezone}
        shiftTargetSeconds={agentConfig.shift.targetSeconds}
      />
    </>
  );
}
