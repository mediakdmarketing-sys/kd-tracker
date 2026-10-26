'use client';

import { useState } from 'react';
import { post } from '@/lib/client';
import PasswordField from '@/components/PasswordField';

export default function ChangePasswordForm({ temporary }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (next.length < 8) {
      setError('The new password must be at least 8 characters.');
      return;
    }
    if (next !== again) {
      setError('The two new passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await post('/api/auth/change-password', { currentPassword: current, newPassword: next });
      // Every session ended with the change, this one too: sign in again with the new password.
      window.location.href = '/login?changed=1';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error ? (
        <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
          {error}
        </div>
      ) : null}

      <div className="field">
        <PasswordField
          id="current"
          label={temporary ? 'Temporary password (from your invitation)' : 'Current password'}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
          inputStyle={{ fontSize: 14, padding: '10px 36px 10px 12px' }}
        />
      </div>

      <div className="field">
        <PasswordField
          id="new"
          label="New password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          disabled={busy}
          inputStyle={{ fontSize: 14, padding: '10px 36px 10px 12px' }}
        />
      </div>

      <div className="field">
        <PasswordField
          id="again"
          label="New password again"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
          inputStyle={{ fontSize: 14, padding: '10px 36px 10px 12px' }}
        />
      </div>

      <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
      <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
        You will be signed out and asked to sign in again with the new password.
      </p>
    </form>
  );
}
