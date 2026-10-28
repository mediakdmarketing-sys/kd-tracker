'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, call } from '@/lib/client';

const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default function AnnouncementManager({ list, canEdit }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('info');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const publish = (e) => {
    e.preventDefault();
    return run(async () => {
      await post('/api/super/announcements', {
        message,
        level,
        ...(startsAt && { startsAt: new Date(startsAt).toISOString() }),
        ...(endsAt && { endsAt: new Date(endsAt).toISOString() }),
      });
      setMessage('');
      setStartsAt('');
      setEndsAt('');
    });
  };

  const end = (a) => run(() => call(`/api/super/announcements/${a.id}`, { method: 'DELETE' }));

  return (
    <div className="stack">
      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {canEdit && (
        <div className="card">
          <div className="card-head">
            <h2>New announcement</h2>
          </div>
          <div className="card-pad">
            <form onSubmit={publish}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="an-msg">Message</label>
                <input
                  id="an-msg"
                  required
                  maxLength={400}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Scheduled maintenance tonight at 10 PM. WorkBuddy may be unavailable for 15 minutes."
                  disabled={busy}
                />
              </div>
              <div className="filters" style={{ marginBottom: 12 }}>
                <div className="field">
                  <label htmlFor="an-level">Style</label>
                  <select id="an-level" value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
                    <option value="info">Information</option>
                    <option value="warn">Warning</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="an-from">Show from (optional)</label>
                  <input id="an-from" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={busy} />
                </div>
                <div className="field">
                  <label htmlFor="an-to">Until (optional)</label>
                  <input id="an-to" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={busy} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy || message.trim().length < 3}>
                Publish
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Message</th>
                <th>Shown</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No announcements yet.</div>
                  </td>
                </tr>
              ) : (
                list.map((a) => (
                  <tr key={a.id}>
                    <td style={{ maxWidth: 460 }}>
                      <span className={`pill ${a.level === 'warn' ? 'pill-flag' : 'pill-idle'}`} style={{ marginRight: 8 }}>
                        {a.level}
                      </span>
                      {a.message}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {fmt(a.startsAt)}
                      {a.endsAt ? ` → ${fmt(a.endsAt)}` : ' → until ended'}
                    </td>
                    <td>{a.active ? <span className="pill pill-working">showing</span> : <span className="faint">not showing</span>}</td>
                    <td>
                      {canEdit && a.active && (
                        <button type="button" className="btn" onClick={() => end(a)} disabled={busy}>
                          End now
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
