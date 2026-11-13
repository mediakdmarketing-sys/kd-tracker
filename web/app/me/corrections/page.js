import { api, requireUser } from '@/lib/api';
import { daysAgoDate, dateLabel, duration, time, todayIn } from '@/lib/format';
import CorrectionForm from './CorrectionForm';
import CancelCorrectionButton from './CancelCorrectionButton';

export const metadata = { title: 'Time corrections · WorkInvigilator' };

const WINDOW_DAYS = 14; // the server's limit (backend/src/modules/corrections/corrections.service.js)
const STATUS_CLASS = { pending: 'pill-idle', approved: 'pill-working', rejected: 'pill-flag', cancelled: 'pill-none' };

export default async function MyCorrectionsPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser();
  const tz = user.timezone;
  const today = todayIn(tz);
  const from = daysAgoDate(WINDOW_DAYS, tz);

  const [requests, history] = await Promise.all([
    api('/api/corrections/me'),
    api(`/api/attendance/me?${new URLSearchParams({ from, to: today, limit: '50' })}`),
  ]);

  const shifts = history.data.filter((s) => s.status === 'closed' && s.punchOut);
  const dates = Array.from({ length: WINDOW_DAYS + 1 }, (_, i) => daysAgoDate(i, tz)); // today first

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time corrections</h1>
          <p>Fix a punch-in or punch-out you forgot, with HR’s approval.</p>
        </div>
      </div>

      <div className="stack">
        <CorrectionForm shifts={shifts} dates={dates} timezone={tz} initialShiftId={params.shift || ''} />

        <div className="card">
          <div className="card-head">
            <h2>Your requests</h2>
          </div>
          {requests.length === 0 ? (
            <div className="empty">No requests yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Was</th>
                    <th>Asked for</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>HR’s note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td className="num">{dateLabel(r.date)}</td>
                      <td className="num muted">
                        {r.original ? `${time(r.original.punchIn, tz)} – ${time(r.original.punchOut, tz)}` : 'Not recorded'}
                      </td>
                      <td className="num">
                        {time(r.requested.punchIn, tz)} – {time(r.requested.punchOut, tz)}
                        <div className="faint" style={{ fontSize: 11 }}>{duration(r.requestedSeconds)}</div>
                      </td>
                      <td className="muted">{r.reason}</td>
                      <td>
                        <span className={`pill ${STATUS_CLASS[r.status]}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                        {r.reviewedBy && <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>by {r.reviewedBy}</div>}
                      </td>
                      <td className="muted">{r.reviewNote || '—'}</td>
                      <td>{r.status === 'pending' && <CancelCorrectionButton id={r.id} />}</td>
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
