'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

export default function GeneratePayroll({ month, hasRows }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    if (
      hasRows &&
      !window.confirm(
        `Regenerate payroll for ${month}? Existing figures are overwritten and any "synced" marks are cleared.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await post('/api/payroll/generate', { month });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? 'Generating…' : hasRows ? 'Regenerate' : 'Generate'}
      </button>
      {error ? (
        <div className="notice notice-danger" style={{ marginTop: 8 }} role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
