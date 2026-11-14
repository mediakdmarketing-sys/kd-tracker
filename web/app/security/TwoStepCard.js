'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { post } from '@/lib/client';

const groups = (secret) => secret.match(/.{1,4}/g).join(' ');

/** Turn two-step sign-in on or off, and manage the recovery codes. */
export default function TwoStepCard({ status }) {
  const router = useRouter();
  const [step, setStep] = useState('idle'); // idle | scan | codes
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl, qr }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The two forms that need the password and a current code.
  const [panel, setPanel] = useState(null); // 'off' | 'codes'
  const [password, setPassword] = useState('');
  const [proof, setProof] = useState('');

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

  const begin = () =>
    run(async () => {
      const made = await post('/api/auth/2fa/setup');
      const qr = await QRCode.toDataURL(made.otpauthUrl, { margin: 1, width: 184 });
      setSetup({ ...made, qr });
      setCode('');
      setStep('scan');
    });

  const confirm = (event) => {
    event.preventDefault();
    return run(async () => {
      const result = await post('/api/auth/2fa/enable', { code });
      setCodes(result.recoveryCodes);
      setSaved(false);
      setSetup(null);
      setStep('codes');
    });
  };

  const turnOff = (event) => {
    event.preventDefault();
    return run(async () => {
      await post('/api/auth/2fa/disable', { password, code: proof });
      setPanel(null);
      setPassword('');
      setProof('');
      router.refresh();
    });
  };

  const newCodes = (event) => {
    event.preventDefault();
    return run(async () => {
      const result = await post('/api/auth/2fa/recovery-codes', { password, code: proof });
      setCodes(result.recoveryCodes);
      setSaved(false);
      setPanel(null);
      setPassword('');
      setProof('');
      setStep('codes');
    });
  };

  function download() {
    const blob = new Blob(
      [`WorkInvigilator recovery codes\nEach works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workinvigilator-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card card-pad">
      <div className="inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 650, fontSize: 15 }}>Two-step sign-in</div>
        <span className={`pill ${status.enabled ? 'pill-working' : 'pill-none'}`}>{status.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="faint" style={{ marginTop: 6, fontSize: 13 }}>
        After your password, you also enter a 6-digit code from an authenticator app on your phone (Google Authenticator,
        Microsoft Authenticator, Authy). A stolen password alone then cannot sign in.
      </p>

      {status.required && !status.enabled && (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: 12 }}>
          HR requires two-step sign-in for admins. Set it up now to carry on.
        </div>
      )}
      {error && <div className="notice notice-danger" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Recovery codes, shown once */}
      {step === 'codes' && codes && (
        <div>
          <div className="notice notice-info" role="status">
            Save these recovery codes now. If you lose your phone, each one lets you sign in once. They are shown only this one time.
          </div>
          <ul className="sec-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</button>
            <button type="button" className="btn" onClick={download}>Download</button>
          </div>
          <label className="inline" style={{ gap: 8, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have saved my recovery codes
          </label>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary" disabled={!saved} onClick={() => { setStep('idle'); setCodes(null); router.refresh(); }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Set up */}
      {step === 'scan' && setup && (
        <form onSubmit={confirm}>
          <ol style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
            <li>Open your authenticator app and add an account: scan the picture, or type the key.</li>
            <li>Enter the 6-digit code the app shows to turn it on.</li>
          </ol>
          <div className="sec-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Cannot scan? Type this key:</div>
              <div className="sec-secret">{groups(setup.secret)}</div>
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="enable-code">Code from the app</label>
                <input id="enable-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus
                  value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" disabled={busy}
                  style={{ letterSpacing: '0.3em', fontSize: 18 }} />
              </div>
              <div className="inline" style={{ gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Turn on'}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => { setStep('idle'); setSetup(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {step === 'idle' && !status.enabled && (
        <button type="button" className="btn btn-primary" onClick={begin} disabled={busy}>
          {busy ? 'Starting…' : 'Set up two-step sign-in'}
        </button>
      )}

      {/* Already on */}
      {step === 'idle' && status.enabled && (
        <div>
          <div className="faint" style={{ fontSize: 13 }}>
            On since {new Date(status.enabledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.{' '}
            {status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.
            {status.recoveryCodesLeft <= 3 && ' Make new ones soon.'}
          </div>
          <div className="inline" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => { setPanel(panel === 'codes' ? null : 'codes'); setError(null); }}>New recovery codes</button>
            {!status.required && (
              <button type="button" className="btn btn-danger" onClick={() => { setPanel(panel === 'off' ? null : 'off'); setError(null); }}>Turn off</button>
            )}
          </div>

          {panel && (
            <form onSubmit={panel === 'off' ? turnOff : newCodes} style={{ marginTop: 14, maxWidth: 360 }}>
              <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>
                {panel === 'off' ? 'To turn it off, confirm with your password and a code from the app.' : 'New codes replace all the old ones. Confirm with your password and a code from the app.'}
              </p>
              <div className="field">
                <label htmlFor="sec-pw">Password</label>
                <input id="sec-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="sec-code">Code from the app</label>
                <input id="sec-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={proof} onChange={(e) => setProof(e.target.value)} disabled={busy} placeholder="123456" />
              </div>
              <button type="submit" className={`btn ${panel === 'off' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
                {busy ? 'Checking…' : panel === 'off' ? 'Turn off two-step sign-in' : 'Make new codes'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
