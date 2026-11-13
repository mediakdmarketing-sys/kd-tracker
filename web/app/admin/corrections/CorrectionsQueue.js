'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { dateLabel, duration, time } from '@/lib/format';

const STATUS_CLASS = { pending: 'pill-idle', approved: 'pill-working', rejected: 'pill-flag', cancelled: 'pill-none' };

/** HR's list of time correction requests: the times as they are, as asked for, and the decision. */
export default function CorrectionsQueue({ requests, timezone, currentUserId }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState(null);

  async function decide(id, status) {
    setBusyId(id);
    setError(null);
    try {
      await post(`/api/corrections/${id}/review`, { status, note: notes[id]?.trim() || undefined });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!requests.length) {
    return (
      <div className="card">
        <div className="empty">Nothing here.</div>
      </div>
    );
  }

  return (
    <div className="card">
      {error && <div className="notice notice-danger" style={{ margin: 14 }} role="alert">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Now</th>
              <th>Asked for</th>
              <th>Reason</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const own = r.employeeId === currentUserId;
              const change = r.original && r.original.punchOut
                ? Math.round((new Date(r.requested.punchOut) - new Date(r.requested.punchIn) - (new Date(r.original.punchOut) - new Date(r.original.punchIn))) / 1000)
                : null;
              return (
                <tr key={r.id}>
                  <td>
                    <div>{r.employeeName}</div>
                    <div className="faint">{r.department || '—'}</div>
                  </td>
                  <td className="num">{dateLabel(r.date)}</td>
                  <td className="num muted">
                    {r.original ? `${time(r.original.punchIn, timezone)} – ${time(r.original.punchOut, timezone)}` : 'No shift recorded'}
                  </td>
                  <td className="num">
                    {time(r.requested.punchIn, timezone)} – {time(r.requested.punchOut, timezone)}
                    <div className="faint" style={{ fontSize: 11 }}>
                      {duration(r.requestedSeconds)}
                      {change !== null && change !== 0 && ` (${change > 0 ? '+' : '−'}${duration(Math.abs(change))})`}
                    </div>
                  </td>
                  <td className="muted" style={{ maxWidth: 260 }}>{r.reason}</td>
                  <td>
                    <span className={`pill ${STATUS_CLASS[r.status]}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                    {r.reviewedBy && <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>by {r.reviewedBy}</div>}
                    {r.reviewNote && <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>{r.reviewNote}</div>}
                  </td>
                  <td>
                    {r.status === 'pending' && own && (
                      <div className="faint" style={{ fontSize: 12, minWidth: 180 }}>Your own request. Another admin has to decide it.</div>
                    )}
                    {r.status === 'pending' && !own && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
                        <input
                          type="text"
                          placeholder="Note (needed to reject)"
                          value={notes[r.id] || ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          disabled={busyId === r.id}
                          style={{ fontSize: 12, padding: '5px 8px' }}
                        />
                        <div className="inline">
                          <button type="button" className="btn btn-primary" disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')}>
                            {busyId === r.id ? 'Saving…' : 'Approve'}
                          </button>
                          <button type="button" className="btn btn-danger" disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')}>
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
