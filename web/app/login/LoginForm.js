'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '@/lib/client';
import PasswordField from '@/components/PasswordField';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await post('/login', { email, password });
      router.replace(params.get('next') || '/');
      router.refresh();
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
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@kdmarketing.in"
        />
      </div>

      <div className="field">
        <PasswordField
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
          inputStyle={{ fontSize: 14, padding: '10px 36px 10px 12px' }}
        />
      </div>

      <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
