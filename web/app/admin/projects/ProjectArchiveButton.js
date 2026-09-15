'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';

export default function ProjectArchiveButton({ project }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const archived = project.status === 'archived';

  async function toggle() {
    setBusy(true);
    try {
      await patch(`/api/admin/projects/${project.id}`, {
        status: archived ? 'active' : 'archived',
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn" disabled={busy} onClick={toggle}>
      {busy ? 'Saving…' : archived ? 'Reactivate' : 'Archive'}
    </button>
  );
}
