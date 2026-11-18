'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/bff/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message || 'Could not send the link. Please try again.');
      setDone(payload.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <div className="notice notice-info" role="status" style={{ marginBottom: 14 }}>{done}</div>
        <p className="muted" style={{ fontSize: 13 }}>
          Nothing arrived after a few minutes? Check the spam folder, or ask HR to send you a new invitation.
        </p>
        <Link href="/login" className="btn btn-lg" style={{ width: '100%', textAlign: 'center' }}>Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">{error}</div> : null}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@kdmarketing.in" disabled={busy} />
      </div>
      <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      <div style={{ marginTop: 12, fontSize: 13 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </form>
  );
}
