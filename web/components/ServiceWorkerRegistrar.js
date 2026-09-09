'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js after the page loads.
 * Rendered in the root layout so it runs on every page without blocking render.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.warn('SW registration failed:', err));
    }
  }, []);

  return null;
}
