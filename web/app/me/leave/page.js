import { api, requireUser } from '@/lib/api';
import LeaveRequestForm from './LeaveRequestForm';
import CancelLeaveButton from './CancelLeaveButton';
import { dateLabel } from '@/lib/format';

export const metadata = { title: 'Leave · WorkBuddy' };

const STATUS_CLASS = {
  pending: 'pill-idle',
  approved: 'pill-working',
  rejected: 'pill-flag',
  cancelled: 'pill-none',
};

export default async function MyLeavePage() {
  const [user, requests] = await Promise.all([
    requireUser(),
    api('/api/leave/me'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leave</h1>
          <p>Request time off and track where each request stands.</p>
        </div>
      </div>

      <div className="stack">
        <LeaveRequestForm name={user.name} email={user.email} timezone={user.timezone} />

        <div className="notice notice-warn" style={{ fontSize: 13 }}>
          For the Sick Leaves, Bereavement Leaves, and Emergency Leaves, should provide proper
          proof. For example, if you are taking sick leave you need to provide an authenticated
          medical certificate from your doctor with the doctor&apos;s information — otherwise
          that leave is considered a No Pay Leave.
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Your requests</h2>
          </div>
          {requests.length === 0 ? (
            <div className="empty">No leave requests yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Day</th>
                    <th>Reason</th>
                    <th>Proof</th>
                    <th>Status</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.typeLabel}</td>
                      <td className="num">
                        {r.startDate === r.endDate
                          ? dateLabel(r.startDate)
                          : `${dateLabel(r.startDate)} – ${dateLabel(r.endDate)}`}
                      </td>
                      <td className="muted">{r.dayPartLabel}</td>
                      <td className="muted">{r.reason || '—'}</td>
                      <td>
                        {r.hasProof ? (
                          <a href={`/bff/api/leave/${r.id}/proof`} target="_blank" rel="noopener noreferrer">
                            {r.proofFileName || 'View file'}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${STATUS_CLASS[r.status]}`}>
                          {r.status[0].toUpperCase() + r.status.slice(1)}
                        </span>
                      </td>
                      <td className="muted">
                        {r.reviewNote || (r.status === 'pending' ? '—' : '')}
                      </td>
                      <td>
                        {r.status === 'pending' && <CancelLeaveButton id={r.id} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
