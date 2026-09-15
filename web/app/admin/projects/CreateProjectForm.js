'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function CreateProjectForm({ departments = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [department, setDepartment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    setOpen(false);
    setName('');
    setClient('');
    setDepartment('');
    setError(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call('/api/admin/projects', {
        method: 'POST',
        body: {
          name: name.trim(),
          client: client.trim() || undefined,
          department: department || undefined,
        },
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
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          + New project
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
        <div style={{ fontWeight: 650, fontSize: 14 }}>New project</div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="proj-name">Project name *</label>
          <input
            id="proj-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client Website Redesign"
            required
            disabled={busy}
            autoFocus
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="proj-client">Client (optional)</label>
          <input
            id="proj-client"
            type="text"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Who this work is billed to, if anyone"
            disabled={busy}
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="proj-dept">Department (optional)</label>
          {departments.length > 0 ? (
            <select
              id="proj-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={busy}
            >
              <option value="">Every department</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input
              id="proj-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Leave blank for every department"
              disabled={busy}
            />
          )}
          <span className="faint" style={{ fontSize: 12 }}>
            Leave blank if more than one team works on this.
          </span>
        </div>

        {error && <div className="notice notice-danger" role="alert">{error}</div>}

        <div className="inline">
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
