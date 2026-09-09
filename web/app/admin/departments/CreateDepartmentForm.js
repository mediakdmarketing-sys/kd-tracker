'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function CreateDepartmentForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    setOpen(false);
    setName('');
    setDescription('');
    setError(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call('/api/admin/departments', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() || undefined },
      });
      close();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card card-pad">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOpen(true)}
        >
          + Create department
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <form
        onSubmit={handleCreate}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}
      >
        <div style={{ fontWeight: 650, fontSize: 14 }}>New department</div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="dept-name">Department name *</label>
          <input
            id="dept-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering, Sales, HR"
            required
            disabled={busy}
            autoFocus
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="dept-desc">Description (optional)</label>
          <input
            id="dept-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            disabled={busy}
          />
        </div>

        {error && (
          <div className="notice notice-danger" role="alert">{error}</div>
        )}

        <div className="inline">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
