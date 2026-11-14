'use client';

/**
 * ThemeToggle — light-only build.
 *
 * The portal is light-only by request (fix #10). The component is kept as a named export
 * so every import site (AppShell, login page, consent page) compiles without change.
 * Re-enabling dark mode later requires only restoring this file — no callsite edits needed.
 *
 * On mount: clears any stale "dark" value from localStorage and forces data-theme="light"
 * on <html>, so a user who previously chose dark mode is migrated cleanly on their next
 * page load rather than seeing a flash of dark before the toggle fires.
 */

import { useEffect } from 'react';

export default function ThemeToggle({ collapsed: _collapsed = false }) {
  useEffect(() => {
    try { localStorage.removeItem('kd_theme'); } catch { /* storage blocked — ignore */ }
    document.documentElement.setAttribute('data-theme', 'light');
  }, []);

  // No button rendered — the portal is light-only.
  return null;
}
