'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

/**
 * Modal dialog to edit a department's name, description, and primary leader.
 * Props:
 *   dept        – { id, name, description }
 *   leaders     – flat list of all leader assignments from /api/admin/department-leaders
 *   employees   – active employee list [ { id, name } ]
 *   onClose     – called when the modal should be dismissed
 */
export default function EditDepartmentModal({ dept, leaders, employees, onClose }) {
  const router = useRouter();
  const [name, setName] = useState(dept.name);
  const [description, setDescription] = useState(dept.description || '');
  // Current leader for this dept (first one if multiple; most depts have one).
  const currentLeader = leaders.find((l) => l.department === dept.name);
  const [leaderId, setLeaderId] = useState(currentLeader?.employeeId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (mounted) closeRef.current?.focus(); }, [mounted]);
  useEffect(() => {
    if (!mounted) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(`/api/admin/departments/${dept.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          // Send leaderId always so the backend can clear leaders when set to ''.
          leaderId: leaderId || null,
        },
      });
      router.refresh();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edm-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '24px 28px',
          maxWidth: 460,
          width: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div id="edm-title" style={{ fontWeight: 700, fontSize: 15 }}>
          Edit department
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="edm-name">Department name *</label>
            <input
              id="edm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy}
              autoFocus
            />
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="edm-desc">Description (optional)</label>
            <input
              id="edm-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              disabled={busy}
            />
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="edm-leader">Department leader</label>
            <select
              id="edm-leader"
              value={leaderId}
              onChange={(e) => setLeaderId(e.target.value)}
              disabled={busy}
            >
              <option value="">— None —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                  {emp.email ? ` (${emp.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="notice notice-danger" role="alert">{error}</div>
          )}

          <div className="inline" style={{ justifyContent: 'flex-end' }}>
            <button
              ref={closeRef}
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
