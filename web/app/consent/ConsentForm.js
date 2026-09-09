'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

export default function ConsentForm({ user }) {
  const router = useRouter();
  const [acceptMonitoring, setAcceptMonitoring] = useState(user.consent.monitoring);
  const [acceptAudio, setAcceptAudio] = useState(user.consent.audio);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const alreadyConsented = user.consent.monitoring && !user.consent.required;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await post('/api/auth/consent', {
        // Monitoring consent is only ever sent as an acceptance; the API refuses withdrawal
        // through the app and directs the employee to HR.
        ...(acceptMonitoring && !user.consent.monitoring ? { monitoringConsent: true } : {}),
        audioConsent: acceptAudio,
      });
      router.replace(user.role === 'admin' ? '/admin' : '/me');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 22 }}>
      {error ? (
        <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
          {error}
        </div>
      ) : null}

      <div className="stack" style={{ gap: 10 }}>
        <label className="inline" style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={acceptMonitoring}
            disabled={user.consent.monitoring}
            onChange={(e) => setAcceptMonitoring(e.target.checked)}
          />
          <span>
            I have read the above and accept screenshot and activity monitoring during my shifts.
          </span>
        </label>

        <label className="inline" style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={acceptAudio}
            onChange={(e) => setAcceptAudio(e.target.checked)}
          />
          <span>
            I also agree to periodic audio samples. <span className="faint">(Optional. You can turn
            this off at any time, and nothing is recorded while it is off.)</span>
          </span>
        </label>
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !acceptMonitoring}>
          {busy ? 'Saving…' : alreadyConsented ? 'Save preference' : 'Accept and continue'}
        </button>
      </div>

      {user.consent.monitoring ? (
        <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
          Monitoring consent was recorded on{' '}
          {new Date(user.consent.givenAt).toISOString().slice(0, 10)}. To withdraw it, speak to HR —
          it cannot be changed from here.
        </p>
      ) : null}
    </form>
  );
}
