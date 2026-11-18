'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '@/lib/client';
import PasswordField from '@/components/PasswordField';
import ShapeLoader from '@/components/ShapeLoader';
import { connectDesktopAgent } from '@/lib/agentConnect';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Two-step sign-in: after the password, the account may ask for a code from an authenticator app.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  function finish() {
    // Signed in here => sign the desktop agent in too. Best-effort, never blocks the portal.
    connectDesktopAgent();
    router.replace(params.get('next') || '/');
    router.refresh();
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (challenge) {
        await post('/login/verify', {
          challengeToken: challenge,
          ...(useRecovery ? { recoveryCode: code } : { code }),
        });
        finish();
        return;
      }

      const result = await post('/login', { email, password });
      if (result?.twoFactorRequired) {
        setChallenge(result.challengeToken);
        setPassword('');
        setBusy(false);
        return;
      }
      finish();
    } catch (err) {
      setError(err.message);
      setBusy(false);
      // A challenge that has expired cannot be answered: go back to the password.
      if (challenge && /took too long/i.test(err.message)) {
        setChallenge(null);
        setCode('');
      }
    }
  }

  function back() {
    setChallenge(null);
    setCode('');
    setUseRecovery(false);
    setError(null);
  }

  return (
    <form onSubmit={submit}>
      {params.get('changed') ? (
        <div className="notice notice-info" style={{ marginBottom: 14 }} role="status">
          Your password was changed. Sign in with the new one.
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
          {error}
        </div>
      ) : null}

      {challenge ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {useRecovery
              ? 'Enter one of your recovery codes. Each one works once.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
          <div className="field">
            <label htmlFor="code">{useRecovery ? 'Recovery code' : 'Code'}</label>
            <input
              id="code"
              key={useRecovery ? 'recovery' : 'code'}
              type="text"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={useRecovery ? 20 : 7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useRecovery ? 'xxxx-xxxx-xxxx' : '123456'}
              disabled={busy}
              style={{ letterSpacing: useRecovery ? 'normal' : '0.3em', fontSize: 18 }}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Checking…' : 'Verify and sign in'}
          </button>
          <div className="inline" style={{ justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
            <button type="button" className="linklike" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(null); }}>
              {useRecovery ? 'Use the app code instead' : 'Use a recovery code'}
            </button>
            <button type="button" className="linklike" onClick={back}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
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
          <div style={{ marginTop: 12, fontSize: 13, textAlign: 'center' }}>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
        </>
      )}

      {/* Stays up until the next page has taken over, so there is no blank wait after the click. */}
      {busy && (
        <div className="wl-overlay">
          <ShapeLoader label={challenge ? 'Checking your code' : 'Signing you in'} />
        </div>
      )}
    </form>
  );
}
