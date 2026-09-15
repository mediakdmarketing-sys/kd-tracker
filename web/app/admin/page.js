import { api, requireUser } from '@/lib/api';
import LiveBoard from '@/components/LiveBoard';

export const metadata = { title: 'Live board · WorkBuddy' };

export default async function AdminDashboardPage() {
  // requireUser and the dashboard fetch are independent — run them in parallel so the page
  // latency is max(auth, data) rather than auth + data.
  const [user, dashboard, agentConfig] = await Promise.all([
    requireUser({ adminOnly: true }),
    api('/api/admin/dashboard'),
    api('/api/config'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Live board</h1>
          <p>Who is working right now, refreshed every 5 minutes.</p>
        </div>
      </div>

      <LiveBoard
        initial={dashboard}
        timezone={user.timezone}
        shiftTargetSeconds={agentConfig.shift.targetSeconds}
      />
    </>
  );
}
