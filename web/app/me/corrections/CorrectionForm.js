'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

/** "HH:MM" on the 24-hour clock in the company's time zone, for a time input. */
function clock(iso, timezone) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

const dayLabel = (date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Ask for a finished shift's times to be changed, or for a forgotten shift to be added.
 * @param {{shifts: Array, dates: string[], timezone: string, initialShiftId?: string}} props
 */
export default function CorrectionForm({ shifts, dates, timezone, initialShiftId = '' }) {
  const router = useRouter();
  const first = shifts.find((s) => s.id === initialShiftId);
  const [shiftId, setShiftId] = useState(first ? first.id : '');
  const [date, setDate] = useState(first ? first.date : dates[1] || dates[0]);
  const [punchIn, setPunchIn] = useState(first ? clock(first.punchIn, timezone) : '09:00');
  const [punchOut, setPunchOut] = useState(first ? clock(first.punchOut, timezone) : '17:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const chosen = useMemo(() => shifts.find((s) => s.id === shiftId) || null, [shifts, shiftId]);

  function pick(id) {
    setShiftId(id);
    setSent(false);
    const s = shifts.find((x) => x.id === id);
    if (s) {
      setDate(s.date);
      setPunchIn(clock(s.punchIn, timezone));
      setPunchOut(clock(s.punchOut, timezone));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await post('/api/corrections', {
        ...(chosen ? { attendanceId: chosen.id } : { date }),
        punchIn,
        punchOut,
        reason,
      });
      setSent(true);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad" onSubmit={submit}>
      <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>Ask for a time correction</div>
      <p className="faint" style={{ marginTop: 0, fontSize: 13 }}>
        Forgot to punch out, or never punched in? Give the right times and a reason. HR decides, and your hours change only
        if they approve. Times are New York time. Only the last 14 days can be corrected.
      </p>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <div className="field">
          <label htmlFor="corr-shift">Which shift</label>
          <select id="corr-shift" value={shiftId} onChange={(e) => pick(e.target.value)} disabled={busy}>
            <option value="">A shift I forgot (add it)</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {dayLabel(s.date)} · {clock(s.punchIn, timezone)}–{clock(s.punchOut, timezone)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="corr-date">Date</label>
          <select id="corr-date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy || Boolean(chosen)}>
            {dates.map((d) => (
              <option key={d} value={d}>{dayLabel(d)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="corr-in">Punch-in</label>
          <input id="corr-in" type="time" required value={punchIn} onChange={(e) => setPunchIn(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="corr-out">Punch-out</label>
          <input id="corr-out" type="time" required value={punchOut} onChange={(e) => setPunchOut(e.target.value)} disabled={busy} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="corr-reason">Reason</label>
        <textarea
          id="corr-reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="For example: forgot to punch out, I worked until 6:00 pm"
          style={{ width: '100%' }}
        />
      </div>

      {error && <div className="notice notice-danger" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {sent && <div className="notice notice-info" role="status" style={{ marginBottom: 10 }}>Sent. HR has been told, and you will get a notification when they decide.</div>}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
