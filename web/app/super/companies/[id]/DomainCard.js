'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch, post } from '@/lib/client';

/**
 * A company's own address (track.acme.com). It is saved first, then checked: the company's DNS must
 * have a CNAME to this platform before the domain serves the company's login page.
 */
export default function DomainCard({ company }) {
  const router = useRouter();
  const [domain, setDomain] = useState(company.customDomain || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await patch(`/api/super/companies/${company.id}/domain`, { customDomain: domain.trim() || null });
      setMessage(domain.trim() ? 'Saved. Now add the DNS record below, then press Check.' : 'Domain removed.');
    });

  const check = () =>
    run(async () => {
      const res = await post(`/api/super/companies/${company.id}/domain/verify`);
      setMessage(
        res.verified
          ? 'Verified. The domain now shows this company’s login page.'
          : `Not pointing here yet. Expected a CNAME to ${res.expected}${res.found.length ? `, found ${res.found.join(', ')}` : ', found nothing'}. DNS changes can take a while.`
      );
    });

  const changed = domain.trim().toLowerCase() !== (company.customDomain || '');

  return (
    <div className="card">
      <div className="card-head">
        <h2>Custom domain</h2>
        {company.customDomain && (
          <span className={`pill ${company.customDomainVerified ? 'pill-working' : 'pill-break'}`}>
            {company.customDomainVerified ? 'verified' : 'not verified'}
          </span>
        )}
      </div>
      <div className="card-pad">
        {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
        {message && !error && <div className="notice notice-info" style={{ marginBottom: 12 }}>{message}</div>}

        <div className="inline" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="dm-domain">Domain</label>
            <input id="dm-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="track.acme.com" disabled={busy} style={{ minWidth: 260 }} />
          </div>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !changed}>Save domain</button>
          {company.customDomain && !changed && (
            <button type="button" className="btn" onClick={check} disabled={busy}>Check DNS</button>
          )}
        </div>

        {company.customDomain && (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <strong>DNS record to add at the company&apos;s domain provider:</strong>
            <div
              style={{
                margin: '6px 0',
                padding: '8px 12px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontFamily: 'monospace',
                userSelect: 'all',
              }}
            >
              CNAME &nbsp; {company.customDomain} &nbsp;→&nbsp; {company.domainTarget || '(set CUSTOM_DOMAIN_TARGET on the server)'}
            </div>
            <span className="faint">
              The domain must also be added to your web host (for example in Vercel: Project → Domains) so it gets a
              certificate. After it shows verified, people open <code>{company.customDomain}</code> and sign in on this
              company&apos;s branded page; only this company&apos;s people can sign in there.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
