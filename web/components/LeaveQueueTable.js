'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';
import { dateLabel } from '@/lib/format';

const STATUS_CLASS = {
  pending: 'pill-idle',
  approved: 'pill-working',
  rejected: 'pill-flag',
  cancelled: 'pill-none',
};

/**
 * Shared between /admin/leave and /leader/leave — same table, same approve/reject action, the
 * only real difference is which API path a decision posts to (admin sees everyone, a leader is
 * scoped server-side to their own departments already, by the route itself).
 */
export default function LeaveQueueTable({ requests, reviewUrlBase }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const [noteDraft, setNoteDraft] = useState({});
  const [error, setError] = useState(null);

  async function decide(id, status) {
    setBusyId(id);
    setError(null);
    try {
      await patch(`${reviewUrlBase}/${id}`, {
        status,
        reviewNote: noteDraft[id]?.trim() || undefined,
      });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return (
      <div className="card">
        <div className="empty">No leave requests here.</div>
      </div>
    );
  }

  return (
    <div className="card">
      {error && (
        <div className="notice notice-danger" style={{ margin: 14 }} role="alert">
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Dates</th>
              <th>Day</th>
              <th>Reason</th>
              <th>Proof</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <div>{r.employeeName}</div>
                  <div className="faint">{r.employeeDepartment || '—'}</div>
                </td>
                <td>
                  {r.typeLabel}
                  {r.proofRequired && (
                    <div className="faint" style={{ fontSize: 11 }}>Proof required</div>
                  )}
                </td>
                <td className="num">
                  {r.startDate === r.endDate
                    ? dateLabel(r.startDate)
                    : `${dateLabel(r.startDate)} – ${dateLabel(r.endDate)}`}
                </td>
                <td className="muted">{r.dayPartLabel}</td>
                <td className="muted">{r.reason || '—'}</td>
                <td>
                  {r.hasProof ? (
                    <a
                      href={`/bff${reviewUrlBase}/${r.id}/proof`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
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
                  {r.status !== 'pending' && r.reviewNote && (
                    <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                      {r.reviewNote}
                    </div>
                  )}
                </td>
                <td>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
                      <input
                        type="text"
                        placeholder="Note (optional)"
                        value={noteDraft[r.id] || ''}
                        onChange={(e) => setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                        disabled={busyId === r.id}
                        style={{ fontSize: 12, padding: '5px 8px' }}
                      />
                      <div className="inline">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'approved')}
                        >
                          {busyId === r.id ? 'Saving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
