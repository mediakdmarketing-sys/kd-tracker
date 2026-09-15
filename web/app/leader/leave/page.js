import { api, requireUser } from '@/lib/api';
import LeaveQueueTable from '@/components/LeaveQueueTable';

export const metadata = { title: 'Leave requests · WorkBuddy' };

export default async function LeaderLeavePage({ searchParams }) {
  const params = await searchParams;
  const status = params.status || 'pending';

  const [, requests] = await Promise.all([
    requireUser(),
    api(`/api/leader/leave${status === 'all' ? '' : `?status=${status}`}`),
  ]);

  const tabs = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leave requests</h1>
          <p>Approve or reject time-off requests from your team.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <div className="inline">
            {tabs.map((tab) => (
              <a
                key={tab.key}
                href={`/leader/leave?status=${tab.key}`}
                className="btn"
                style={status === tab.key ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
              >
                {tab.label}
              </a>
            ))}
          </div>
        </div>

        <LeaveQueueTable requests={requests} reviewUrlBase="/api/leader/leave" />
      </div>
    </>
  );
}
