'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { del, post } from '@/lib/client';

const CLIENT_LABEL = { web: 'Web portal', desktop: 'Desktop agent', chromeos: 'ChromeOS', android: 'Android app' };

/**
 * Where this account is signed in. Ending a session signs that device out at once (not when its
 * login would have expired), so a lost laptop or a forgotten shared computer can be dealt with here.
 */
export default function SessionsCard({ sessions, timezone }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const when = (iso) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

  async function act(id, fn) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const others = sessions.filter((s) => !s.current);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Where you are signed in</h2>
        {others.length > 0 && (
          <button type="button" className="btn btn-danger" disabled={busyId === 'all'} onClick={() => act('all', () => post('/api/auth/sessions/revoke-others'))}>
            {busyId === 'all' ? 'Signing out…' : `Sign out all other ${others.length === 1 ? 'device' : 'devices'}`}
          </button>
        )}
      </div>
      {error && <div className="notice notice-danger" style={{ margin: 14 }} role="alert">{error}</div>}
      {sessions.length === 0 ? (
        <div className="empty">No sessions.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>App</th>
                <th>Address</th>
                <th>Signed in</th>
                <th>Last active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.device}
                    {s.current && <span className="pill pill-working" style={{ marginLeft: 8 }}>This device</span>}
                    {s.twoStep && <span className="faint" style={{ marginLeft: 8, fontSize: 11 }}>two-step</span>}
                  </td>
                  <td className="muted">{CLIENT_LABEL[s.client] || s.client || '—'}</td>
                  <td className="faint num">{s.ip || '—'}</td>
                  <td className="num">{when(s.signedInAt)}</td>
                  <td className="num">{when(s.lastSeenAt)}</td>
                  <td>
                    {!s.current && (
                      <button type="button" className="btn" disabled={busyId === s.id} onClick={() => act(s.id, () => del(`/api/auth/sessions/${s.id}`))}>
                        {busyId === s.id ? 'Signing out…' : 'Sign out'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint" style={{ fontSize: 12.5, margin: 14 }}>
        Do not recognise one? Sign it out, then change your password (that signs out everything).
      </p>
    </div>
  );
}
