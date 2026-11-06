'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

/** Finalize a payroll month (freeze it) or reopen it. */
export default function FinalizeControls({ month, final, hasRows }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function finalize(force = false) {
    setBusy(true);
    setError(null);
    try {
      await post('/api/payroll/finalize', { month, force });
      router.refresh();
    } catch (err) {
      // Warnings (open shifts, days with no rate) can be accepted; anything else is shown as it is.
      if (err.status === 409 && Array.isArray(err.details) && err.details.some((d) => d.code)) {
        const list = err.details.map((d) => `• ${d.message}`).join('\n');
        if (window.confirm(`${err.message}\n\n${list}\n\nFinalize anyway?`)) return finalize(true);
      } else {
        setError([err.message, ...(err.details || []).map((d) => d.message)].join(' · '));
      }
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    const reason = window.prompt(
      `Reopen ${month}? Payslips become changeable again and people can no longer see theirs until you finalize again.\n\nWhy are you reopening it?`
    );
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await post('/api/payroll/reopen', { month, reason });
      router.refresh();
    } catch (err) {
      setError([err.message, ...(err.details || []).map((d) => d.message)].join(' · '));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {final ? (
        <button type="button" className="btn" onClick={reopen} disabled={busy}>
          {busy ? 'Working…' : 'Reopen month'}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.confirm(`Finalize ${month}? Every payslip is frozen as it is now, the month cannot be regenerated, and each person is told their payslip is ready.`) && finalize(false)}
          disabled={busy || !hasRows}
          title={hasRows ? undefined : 'Generate the month first'}
        >
          {busy ? 'Working…' : 'Finalize month'}
        </button>
      )}
      {error && (
        <div className="notice notice-danger" style={{ marginTop: 8 }} role="alert">
          {error}
        </div>
      )}
    </>
  );
}
