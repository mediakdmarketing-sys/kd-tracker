'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch, post, del } from '@/lib/client';
import CompanyLogo from '@/components/CompanyLogo';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 1024 * 1024;

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** Company name and logo: shown on payslips, in payslip emails. Saved on their own, not with the form below. */
export default function BrandingCard({ company, emailConfigured }) {
  const router = useRouter();
  const input = useRef(null);
  const [name, setName] = useState(company.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  async function run(fn, done) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(done);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_BYTES) return setError('The logo must be 1 MB or smaller.');
    await run(async () => post('/api/branding/logo', { contentType: file.type, data: await toBase64(file) }), 'Logo saved.');
  }

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Company</div>

      {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
      {note && <div className="notice notice-info" style={{ marginBottom: 12 }} role="status">{note}</div>}

      <div className="inline" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <CompanyLogo hasLogo={company.hasLogo} version={company.logoUpdatedAt} size={88} />
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            {company.hasLogo ? 'Your logo' : 'No logo yet'}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <button type="button" className="btn btn-info" onClick={() => input.current?.click()} disabled={busy}>
              {company.hasLogo ? 'Replace logo' : 'Upload logo'}
            </button>
            {company.hasLogo && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => window.confirm('Remove the logo?') && run(() => del('/api/branding/logo'), 'Logo removed.')}
              >
                Remove
              </button>
            )}
            <input ref={input} type="file" accept={TYPES.join(',')} onChange={onFile} style={{ display: 'none' }} />
          </div>
          <p className="faint" style={{ margin: '0 0 14px', fontSize: 12 }}>
            PNG, JPEG or WebP, up to 1 MB. A square image works best. It appears on payslips and in
            payslip emails.
          </p>

          <div className="field">
            <label htmlFor="company-name">Company name</label>
            <input
              id="company-name"
              value={name}
              maxLength={120}
              placeholder="KD Marketing"
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || name.trim() === (company.name || '')}
              onClick={() => run(() => patch('/api/admin/settings', { company: { name: name.trim() } }), 'Name saved.')}
            >
              Save name
            </button>
          </div>
        </div>
      </div>

      <div className={`notice ${emailConfigured ? 'notice-info' : 'notice-warn'}`} style={{ marginTop: 16 }}>
        {emailConfigured ? (
          <>Payslip emails are <strong>ready</strong>: send them from the Payroll page.</>
        ) : (
          <>
            Payslip emails are <strong>not set up</strong>. Add <code>RESEND_API_KEY</code> and{' '}
            <code>MAIL_FROM</code> (and <code>PUBLIC_API_URL</code> so the logo shows in emails) to the
            server settings, then restart it.
          </>
        )}
      </div>
    </div>
  );
}
