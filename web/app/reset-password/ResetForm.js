'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PasswordField from '@/components/PasswordField';

async function step(name, body) {
  const res = await fetch(`/bff/password/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || 'Something went wrong. Please try again.');
  return payload;
}

export default function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [state, setState] = useState('checking'); // checking | ready | bad
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Tell the person the link is no good before they type a password for nothing.
  useEffect(() => {
    if (!token) { setState('bad'); return; }
    step('check', { token }).then(() => setState('ready')).catch((e) => { setError(e.message); setState('bad'); });
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    if (password !== again) { setError('The two passwords are not the same.'); return; }
    setBusy(true);
    try {
      await step('reset', { token, newPassword: password });
      router.replace('/login?changed=1');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (state === 'checking') return <p className="muted">Checking your link…</p>;

  if (state === 'bad') {
    return (
      <div>
        <div className="notice notice-danger" role="alert" style={{ marginBottom: 14 }}>
          {error || 'This reset link is not valid any more.'}
        </div>
        <Link href="/forgot-password" className="btn btn-primary btn-lg" style={{ width: '100%', textAlign: 'center' }}>Ask for a new link</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">{error}</div> : null}
      <div className="field">
        <PasswordField id="new-password" label="New password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={busy} />
      </div>
      <div className="field">
        <PasswordField id="again" label="New password again" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" disabled={busy} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>At least 8 characters. You will be signed out everywhere else.</p>
      <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
