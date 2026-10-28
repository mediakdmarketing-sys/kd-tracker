'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, call } from '@/lib/client';
import InviteCard from '@/components/InviteCard';

export default function StaffManager({ staff, meId }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState(null);

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

  const add = (e) => {
    e.preventDefault();
    return run(async () => {
      const created = await post('/api/super/staff', { name, email });
      setInvite({ name: created.name, email: created.email, password: created.temporaryPassword });
      setName('');
      setEmail('');
    });
  };

  const reset = (person) =>
    run(async () => {
      const res = await post(`/api/super/staff/${person.id}/reset-password`);
      setInvite({ name: person.name, email: person.email, password: res.temporaryPassword });
    });

  const remove = (person) => {
    if (!window.confirm(`Remove ${person.name}? They will be signed out and cannot sign in again.`)) return;
    return run(() => call(`/api/super/staff/${person.id}`, { method: 'DELETE' }));
  };

  return (
    <div className="stack">
      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {invite && (
        <InviteCard
          name={invite.name}
          email={invite.email}
          password={invite.password}
          title={`Send ${invite.name} their sign-in details`}
          onDone={() => setInvite(null)}
        />
      )}

      <div className="card">
        <div className="card-head">
          <h2>Add support staff</h2>
        </div>
        <div className="card-pad">
          <form onSubmit={add} className="inline" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="st-name">Name</label>
              <input id="st-name" required value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="st-email">Email</label>
              <input id="st-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !name || !email}>
              Add and get invitation
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Two-factor</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.id === meId ? ' (you)' : ''}
                    <div className="faint" style={{ fontSize: 12 }}>{s.email}</div>
                  </td>
                  <td>{s.platformRole === 'owner' ? 'Owner' : 'Support'}</td>
                  <td>{s.twoFactorEnabled ? 'On' : <span className="faint">Off</span>}</td>
                  <td>{s.status}</td>
                  <td>
                    {s.platformRole === 'support' && s.status === 'active' && (
                      <div className="inline" style={{ gap: 6 }}>
                        <button type="button" className="btn" onClick={() => reset(s)} disabled={busy}>
                          Reset password
                        </button>
                        <button type="button" className="btn" onClick={() => remove(s)} disabled={busy}>
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
