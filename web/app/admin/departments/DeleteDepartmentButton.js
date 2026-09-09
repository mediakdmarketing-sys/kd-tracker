'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function DeleteDepartmentButton({ id, name }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    if (!confirm(`Delete "${name}"?\n\nAll employees will be unassigned and leader assignments removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/admin/departments/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-danger"
        style={{ padding: '4px 12px', fontSize: 12 }}
        disabled={busy}
        onClick={handleDelete}
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error && (
        <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>
          {error}
        </span>
      )}
    </>
  );
}
