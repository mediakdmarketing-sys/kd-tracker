'use client';

import { useState } from 'react';
import { post } from '@/lib/client';

const ROLE_LABEL = { admin: 'HR / Admin', leader: 'Team leader', user: 'Employee' };
const HOME = { admin: '/admin', leader: '/leader', user: '/me' };

/**
 * People of one company the platform owner can step into, to see what they see when something is
 * wrong. The session is theirs for an hour, read-only for the person's own actions, and recorded
 * in the company's audit log.
 */
export default function ViewAsList({ people, suspended }) {
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const q = search.trim().toLowerCase();
  const shown = people.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
  );

  async function go(person) {
    setBusyId(person.id);
    setError(null);
    try {
      const res = await post('/impersonate', { employeeId: person.id });
      window.location.href = HOME[res.role] || '/me';
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>View as a person</h2>
        <span className="faint">To see a problem the way they see it</span>
      </div>
      <div className="card-pad">
        {suspended && (
          <div className="notice notice-warn" style={{ marginBottom: 12 }}>
            This company is suspended. Reactivate it to view as one of its people.
          </div>
        )}
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}
        <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search people"
          />
        </div>
        {shown.length === 0 ? (
          <div className="empty">No one matches.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <div className="faint" style={{ fontSize: 12 }}>{p.email}</div>
                    </td>
                    <td>{ROLE_LABEL[p.role] || p.role}</td>
                    <td className="muted">{p.department || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => go(p)}
                        disabled={busyId !== null || suspended}
                      >
                        {busyId === p.id ? 'Opening…' : 'View as'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
          Lasts one hour at most. You can look around and use the admin and team-leader tools, but
          cannot punch in, give consent, change passwords or request leave as them. The company&apos;s
          audit log shows when you started and ended.
        </p>
      </div>
    </div>
  );
}
