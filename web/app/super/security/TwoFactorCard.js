'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { downloadText } from '@/lib/csv';

const groups = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Turn two-factor sign-in on (scan or type the key into an authenticator app, confirm with a
 * code, keep the recovery codes) or off again (password and a current code).
 */
export default function TwoFactorCard({ enabled, email }) {
  const router = useRouter();
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setSetup(await post('/api/auth/2fa/setup')));

  const confirm = () =>
    run(async () => {
      const res = await post('/api/auth/2fa/enable', { code });
      setRecovery(res.recoveryCodes);
      setSetup(null);
      setCode('');
      router.refresh();
    });

  const disable = () =>
    run(async () => {
      await post('/api/auth/2fa/disable', { password, code });
      // Turning it off signs every session out, this one included.
      window.location.href = '/login';
    });

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the key stays on screen to copy by hand */
    }
  }

  return (
    <div className="stack">
      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {recovery && (
        <div className="card">
          <div className="card-head">
            <h2>Save your recovery codes</h2>
          </div>
          <div className="card-pad">
            <div className="notice notice-warn" style={{ marginBottom: 14 }}>
              <strong>Two-factor is on.</strong> These 8 codes are shown only now. Each works once if you
              lose your phone. Keep them somewhere safe, apart from your password.
            </div>
            <pre
              style={{
                margin: 0,
                padding: 14,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                fontSize: 14,
                columns: 2,
                userSelect: 'all',
              }}
            >
              {recovery.join('\n')}
            </pre>
            <div className="inline" style={{ marginTop: 12, gap: 8 }}>
              <button type="button" className="btn" onClick={() => copy(recovery.join('\n'))}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => downloadText('workbuddy-recovery-codes.txt', recovery.join('\r\n'))}
              >
                Download
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setRecovery(null)}>
                I have saved them
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Two-factor sign-in</h2>
          <span className={`pill ${enabled ? 'pill-working' : 'pill-out'}`}>{enabled ? 'on' : 'off'}</span>
        </div>
        <div className="card-pad">
          {!enabled && !setup && (
            <>
              <p style={{ marginTop: 0 }}>
                After your password you will also be asked for a 6-digit code from an authenticator app
                (Google Authenticator, Microsoft Authenticator, Authy, 1Password...).
              </p>
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
                Set up two-factor
              </button>
            </>
          )}

          {!enabled && setup && (
            <>
              <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                <li>
                  In your authenticator app choose <strong>Add account</strong> then <strong>Enter a setup key</strong>.
                </li>
                <li>
                  Account: <code>{email}</code>. Key:
                  <div
                    style={{
                      margin: '6px 0',
                      padding: '10px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontFamily: 'monospace',
                      fontSize: 15,
                      letterSpacing: 1,
                      userSelect: 'all',
                    }}
                  >
                    {groups(setup.secret)}
                  </div>
                  <span className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn" onClick={() => copy(setup.secret)}>
                      {copied ? 'Copied ✓' : 'Copy key'}
                    </button>
                    <a className="btn" href={setup.otpauthUrl}>
                      Open in authenticator app
                    </a>
                  </span>
                </li>
                <li>Type the 6-digit code the app shows to confirm.</li>
              </ol>
              <div className="inline" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="tf-code">Code</label>
                  <input
                    id="tf-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    disabled={busy}
                  />
                </div>
                <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || code.trim().length < 6}>
                  Turn on
                </button>
                <button type="button" className="btn" onClick={() => setSetup(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {enabled && (
            <>
              <p style={{ marginTop: 0 }}>Sign-in asks for a code from your authenticator app.</p>
              <p className="faint" style={{ fontSize: 13 }}>
                To turn it off, confirm with your password and a current code. This signs you out everywhere.
              </p>
              <div className="inline" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="tf-pw">Password</label>
                  <input id="tf-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="tf-off-code">Current code</label>
                  <input id="tf-off-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
                </div>
                <button type="button" className="btn" onClick={disable} disabled={busy || !password || code.trim().length < 6}>
                  Turn off two-factor
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
