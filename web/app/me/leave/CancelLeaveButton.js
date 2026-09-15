'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

export default function CancelLeaveButton({ id }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await post(`/api/leave/${id}/cancel`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn" disabled={busy} onClick={cancel}>
      {busy ? 'Cancelling…' : 'Cancel'}
    </button>
  );
}
