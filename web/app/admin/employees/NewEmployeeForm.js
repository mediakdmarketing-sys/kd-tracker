'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, call } from '@/lib/client';

const EMPTY = { name: '', email: '', password: '', department: '', role: 'user' };

/**
 * @param {{ departments: string[] }} props
 *   departments — list of department names fetched server-side from /api/admin/departments
 */
export default function NewEmployeeForm({ departments = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  // For leader role: which departments this person leads
  const [leaderDepts, setLeaderDepts] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function toggleLeaderDept(dept) {
    setLeaderDepts((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]
    );
  }

  function close() {
    setOpen(false);
    setForm(EMPTY);
    setLeaderDepts([]);
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // 1. Create the employee
      const created = await post('/api/admin/employees', {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        department: form.department || undefined,
      });

      // 2. If leader role + departments selected → assign leader assignments
      if (form.role === 'leader' && leaderDepts.length > 0) {
        await Promise.all(
          leaderDepts.map((dept) =>
            call('/api/admin/department-leaders', {
              method: 'POST',
              body: { department: dept, employeeId: created.id },
            })
          )
        );
      }

      close();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isLeader = form.role === 'leader';

  if (!open) {
    return (
      <div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Add employee
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Add employee</h2>
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
      <div className="card-pad">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="filters" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="ne-name">Full name</label>
              <input
                id="ne-name"
                required
                value={form.name}
                onChange={set('name')}
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor="ne-email">Work email</label>
              <input
                id="ne-email"
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor="ne-password">Temporary password</label>
              <input
                id="ne-password"
                type="text"
                minLength={8}
                required
                value={form.password}
                onChange={set('password')}
                placeholder="At least 8 characters"
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor="ne-role">Role</label>
              <select
                id="ne-role"
                value={form.role}
                onChange={(e) => {
                  set('role')(e);
                  // Clear leader dept selections when role changes away from leader
                  if (e.target.value !== 'leader') setLeaderDepts([]);
                }}
                disabled={busy}
              >
                <option value="user">Employee</option>
                <option value="leader">Leader</option>
                <option value="admin">HR / Admin</option>
              </select>
            </div>

            {/* Primary department — single select for all roles */}
            {!isLeader && (
              <div className="field">
                <label htmlFor="ne-dept">Department</label>
                {departments.length > 0 ? (
                  <select
                    id="ne-dept"
                    value={form.department}
                    onChange={set('department')}
                    disabled={busy}
                  >
                    <option value="">— Select department —</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="ne-dept"
                    value={form.department}
                    onChange={set('department')}
                    placeholder="No departments yet"
                    disabled={busy}
                  />
                )}
              </div>
            )}
          </div>

          {/* Leader: primary department + multi-department leadership */}
          {isLeader && (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 14,
                marginBottom: 14,
                background: 'var(--surface-2)',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 650,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 10,
                }}
              >
                Departments this leader manages
              </div>

              {departments.length === 0 ? (
                <p className="faint" style={{ margin: 0, fontSize: 13 }}>
                  No departments created yet.{' '}
                  <a href="/admin/departments" style={{ color: 'var(--accent-text)' }}>
                    Create departments first
                  </a>
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {departments.map((dept) => {
                      const selected = leaderDepts.includes(dept);
                      return (
                        <button
                          key={dept}
                          type="button"
                          disabled={busy}
                          onClick={() => toggleLeaderDept(dept)}
                          style={{
                            padding: '5px 14px',
                            borderRadius: 999,
                            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
                            background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                            color: selected ? 'var(--accent-text)' : 'var(--text-muted)',
                            fontWeight: selected ? 650 : 500,
                            fontSize: 13,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {selected ? '✓ ' : ''}{dept}
                        </button>
                      );
                    })}
                  </div>

                  {/* Primary department — which dept the leader belongs to */}
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="ne-dept-primary">
                      Primary department (where this leader is listed as a member)
                    </label>
                    <select
                      id="ne-dept-primary"
                      value={form.department}
                      onChange={set('department')}
                      disabled={busy}
                    >
                      <option value="">— Select primary department —</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>

                  {leaderDepts.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                      Will lead: {leaderDepts.join(', ')}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="inline">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !form.name || !form.email || !form.password}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>

        <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
          The employee accepts the monitoring notice at first sign-in. Consent cannot be set on their behalf.
        </p>
      </div>
    </div>
  );
}
