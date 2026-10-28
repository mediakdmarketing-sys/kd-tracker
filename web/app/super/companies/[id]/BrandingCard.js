'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';
import { logoUrl, brandStyle } from '@/lib/brand';

const MAX_LOGO_BYTES = 512 * 1024;

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * A company's own look: the name on its login page and menu, a colour, a logo and the address it
 * signs in at. Shows a small live preview before anything is saved.
 */
export default function BrandingCard({ company }) {
  const router = useRouter();
  const [slug, setSlug] = useState(company.slug);
  const [name, setName] = useState(company.brand.name || '');
  const [color, setColor] = useState(company.brand.color || '');
  const [logo, setLogo] = useState(null); // { base64, type, preview }
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const validColor = /^#[0-9a-fA-F]{6}$/.test(color);
  const currentLogo = company.brand.hasLogo ? logoUrl(company.slug, company.brand.version) : null;
  const previewLogo = logo ? logo.preview : removeLogo ? null : currentLogo;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  async function pickLogo(e) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('The logo must be a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('The logo must be 512 KB or smaller.');
      return;
    }
    try {
      setLogo({ base64: await readAsBase64(file), type: file.type, preview: URL.createObjectURL(file) });
      setRemoveLogo(false);
      setSaved(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch(`/api/super/companies/${company.id}/branding`, {
        slug: slug.trim().toLowerCase(),
        brandName: name.trim() || null,
        brandColor: color.trim() || null,
        ...(logo && { logoBase64: logo.base64, logoContentType: logo.type }),
        ...(removeLogo && !logo && { removeLogo: true }),
      });
      setLogo(null);
      setRemoveLogo(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Branding &amp; login address</h2>
        <span className="faint">Name, colour and logo of {company.name}</span>
      </div>
      <div className="card-pad">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="notice notice-info" style={{ marginBottom: 14 }}>
            Saved. The login page and menu of this company now use it.
          </div>
        )}

        <div className="filters" style={{ marginBottom: 14 }}>
          <div className="field">
            <label htmlFor="br-name">Display name</label>
            <input
              id="br-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder={`Default: WorkBuddy`}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="br-color">Brand colour</label>
            <div className="inline" style={{ gap: 8 }}>
              <input
                type="color"
                aria-label="Pick a colour"
                value={validColor ? color : '#6d5ef0'}
                onChange={(e) => {
                  setColor(e.target.value);
                  setSaved(false);
                }}
                disabled={busy}
                style={{ width: 44, padding: 2, flex: 'none' }}
              />
              <input
                id="br-color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setSaved(false);
                }}
                placeholder="#6d5ef0 (default if empty)"
                disabled={busy}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="br-slug">Login address</label>
            <input
              id="br-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSaved(false);
              }}
              disabled={busy}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="br-logo">Logo (PNG, JPEG or WebP, up to 512 KB)</label>
          <input id="br-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} disabled={busy} />
          {(company.brand.hasLogo || logo) && (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8, alignSelf: 'flex-start' }}
              onClick={() => {
                setLogo(null);
                setRemoveLogo(true);
                setSaved(false);
              }}
              disabled={busy || (!logo && removeLogo)}
            >
              Remove logo
            </button>
          )}
        </div>

        <div
          style={{
            ...brandStyle(validColor ? color : undefined),
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            background: 'var(--surface-2)',
          }}
          aria-label="Preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewLogo || '/icons/icon-192.png'}
            alt=""
            width={40}
            height={40}
            style={{ objectFit: 'contain', borderRadius: 8 }}
          />
          <span className="brand-word" style={{ fontSize: 22 }}>{name.trim() || 'WorkBuddy'}</span>
          <span className="btn btn-primary" style={{ marginLeft: 'auto', pointerEvents: 'none' }}>Sign in</span>
        </div>

        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (color !== '' && !validColor)}>
          {busy ? 'Saving…' : 'Save branding'}
        </button>

        <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
          Sign-in page for this company:{' '}
          <a href={`${origin}/login?company=${company.slug}`} target="_blank" rel="noopener noreferrer">
            {origin}/login?company={company.slug}
          </a>
          . With a wildcard domain set up (<code>ROOT_DOMAIN</code> on the web server and a DNS record for
          <code> *.yourdomain</code>), the same page is at <code>{company.slug}.yourdomain</code> and only
          this company&apos;s people can sign in there.
        </p>
      </div>
    </div>
  );
}
