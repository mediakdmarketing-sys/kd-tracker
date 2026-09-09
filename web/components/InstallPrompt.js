'use client';

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'kd_install_dismissed';

/**
 * Captures the browser's beforeinstallprompt event and shows a non-intrusive banner at the
 * bottom of the screen. Dismissed state is persisted so the banner doesn't reappear every
 * visit — it only shows again after 30 days or if the user clears site data.
 *
 * The banner is deliberately unobtrusive: no modal, no full-screen takeover, just a slim
 * strip with an Install button and a dismiss ×.
 */
export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if previously dismissed within the last 30 days.
    try {
      const ts = Number(localStorage.getItem(DISMISSED_KEY) || 0);
      if (ts && Date.now() - ts < 30 * 24 * 60 * 60 * 1000) return;
    } catch {
      // localStorage blocked (private mode, etc.) — show the prompt anyway.
    }

    const handler = (e) => {
      // Prevent the default mini-infobar on mobile Chrome so we control the UX.
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    // Whether accepted or dismissed by the user inside the native dialog, we clear our banner.
    setPrompt(null);
    setVisible(false);
  }

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  if (!visible) return null;

  return (
    <div
      role="banner"
      aria-label="Install KD Tracker"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#fff',
        borderTop: '1px solid #e2e5ea',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 -2px 12px rgba(0,0,0,.08)',
      }}
    >
      <img
        src="/icons/icon-192.png"
        alt=""
        width={36}
        height={36}
        style={{ borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Install KD Tracker</div>
        <div style={{ fontSize: 12, color: '#5c6472' }}>
          Add to your home screen for quick access — works offline too.
        </div>
      </div>
      <button
        onClick={install}
        style={{
          background: '#2f5cff',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '8px 16px',
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          fontSize: 20,
          color: '#5c6472',
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
