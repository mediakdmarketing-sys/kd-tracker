'use client';

import { useEffect, useState } from 'react';

// The download button for a platform that ships more than one installer (macOS, Linux). Opens a
// small dialog listing each build; picking one starts that download.

export default function DownloadChoice({ name, options }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => setOpen(true)}>
        Download for {name}
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Download for ${name}`}
            className="card card-pad"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380, textAlign: 'left' }}
          >
            <h2 style={{ margin: '0 0 4px' }}>Download for {name}</h2>
            <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
              Choose the installer that matches your computer.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {options.map((o) => (
                <a
                  key={o.label}
                  className="btn btn-primary btn-lg"
                  href={o.url}
                  download
                  onClick={() => setOpen(false)}
                  style={{ width: '100%' }}
                >
                  {o.label}
                </a>
              ))}
            </div>
            <button type="button" className="btn" onClick={() => setOpen(false)} style={{ width: '100%', marginTop: 10 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
