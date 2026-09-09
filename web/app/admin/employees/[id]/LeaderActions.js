'use client';
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

/**
 * Assign or remove a leader assignment for one department.
 * Rendered in the admin employee detail page.
 */
export default function LeaderActions({ employee, departments, currentLeaderDepts }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDept, setSelectedDept] = useState('');

  // Departments this employee does NOT yet lead (available to assign).
  const available = departments.filter((d) => !currentLeaderDepts.includes(d));

  async function assign() {
    if (!selectedDept) return;
    setBusy('assign');
    setError(null);
    try {
      await call('/api/admin/department-leaders', {
        method: 'POST',
        body: { department: selectedDept, employeeId: employee.id },
      });
      setSelectedDept('');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(department) {
    setBusy(department);
    setError(null);
    try {
      await call('/api/admin/department-leaders', {
        method: 'DELETE',
        body: { department, employeeId: employee.id },
      });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Department leadership</h2>
        <span className="faint">
          {currentLeaderDepts.length > 0
            ? `Leading ${currentLeaderDepts.length} department${currentLeaderDepts.length === 1 ? '' : 's'}`
            : 'Not a leader of any department'}
        </span>
      </div>

      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Current leader assignments */}
        {currentLeaderDepts.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Currently leading
            </div>
            <div className="inline" style={{ flexWrap: 'wrap' }}>
              {currentLeaderDepts.map((dept) => (
                <span key={dept} className="inline" style={{ gap: 6 }}>
                  <span className="pill pill-break">{dept}</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    disabled={busy === dept}
                    onClick={() => remove(dept)}
                  >
                    {busy === dept ? '…' : 'Remove'}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Assign to new department */}
        {available.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Assign as leader of
            </div>
            <div className="inline">
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                disabled={busy === 'assign'}
                style={{ width: 'auto', minWidth: 180 }}
              >
                <option value="">Select department…</option>
                {available.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedDept || busy === 'assign'}
                onClick={assign}
              >
                {busy === 'assign' ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        )}

        {available.length === 0 && currentLeaderDepts.length === 0 && (
          <p className="faint" style={{ margin: 0, fontSize: 13 }}>
            No departments available. Create employees with department names first.
          </p>
        )}

        {error && (
          <div className="notice notice-danger" role="alert">{error}</div>
        )}
      </div>
    </div>
  );
}
