'use client';

import { useState } from 'react';
import { call, post } from '@/lib/client';
import LoginHistoryTable from '@/components/LoginHistoryTable';

const CLIENT_LABEL = { web: 'Web portal', desktop: 'Desktop agent', chromeos: 'ChromeOS', android: 'Android app' };

/**
 * HR's view of one person's sign-in security: two-step status, where they are signed in, how they
 * have been signing in. Nothing is loaded until it is asked for, because looking is recorded in the
 * audit log (sign-in addresses are personal data).
 */
export default function EmployeeSecurityCard({ employee, timezone, canResetTwoStep, isSelf }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function load() {
    setBusy('load');
    setError(null);
    try {
      setData(await call(`/api/admin/employees/${employee.id}/security`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function act(kind, path, message) {
    if (!window.confirm(message)) return;
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      await post(path);
      setDone(kind === 'reset' ? 'Two-step sign-in was turned off for this person. They can set it up again under Security.' : 'Their sessions were ended.');
      setData(await call(`/api/admin/employees/${employee.id}/security`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const when = (iso) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sign-in security</h2>
        {!data && (
          <button type="button" className="btn" onClick={load} disabled={busy === 'load'}>
            {busy === 'load' ? 'Loading…' : 'Show sign-in details'}
          </button>
        )}
      </div>
      {!data && !error && (
        <div className="card-pad faint" style={{ paddingTop: 0, fontSize: 13 }}>
          Where {employee.name} is signed in and how they have signed in. Looking is recorded in the audit log.
        </div>
      )}
      {error && <div className="notice notice-danger" style={{ margin: 14 }} role="alert">{error}</div>}
      {done && <div className="notice notice-info" style={{ margin: 14 }} role="status">{done}</div>}

      {data && (
        <div className="stack" style={{ padding: 14 }}>
          <div className="inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              Two-step sign-in:{' '}
              <span className={`pill ${data.twoFactor.enabled ? 'pill-working' : 'pill-none'}`}>{data.twoFactor.enabled ? 'On' : 'Off'}</span>
              {data.twoFactor.required && !data.twoFactor.enabled && <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>required, not set up yet</span>}
            </div>
            <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              {canResetTwoStep && !isSelf && (data.twoFactor.enabled || data.twoFactor.setupPending) && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy === 'reset'}
                  onClick={() => act('reset', `/api/admin/employees/${employee.id}/2fa/reset`, `Turn off two-step sign-in for ${employee.name}? Only do this if they lost their phone and recovery codes. It also signs them out everywhere.`)}
                >
                  Reset two-step
                </button>
              )}
              {data.sessions.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy === 'end'}
                  onClick={() => act('end', `/api/admin/employees/${employee.id}/sessions/revoke-all`, `Sign ${employee.name} out of every device?`)}
                >
                  Sign out everywhere
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Signed in now ({data.sessions.length})</div>
            {data.sessions.length === 0 ? (
              <div className="faint" style={{ fontSize: 13 }}>Not signed in anywhere.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Device</th><th>App</th><th>Address</th><th>Last active</th></tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.device}</td>
                        <td className="muted">{CLIENT_LABEL[s.client] || s.client || '—'}</td>
                        <td className="faint num">{s.ip || '—'}</td>
                        <td className="num">{when(s.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Recent sign-ins</div>
            <LoginHistoryTable history={data.history} timezone={timezone} />
          </div>
        </div>
      )}
    </div>
  );
}
