'use client';

import { useEffect } from 'react';

// Opens the collapsed section a link points at. A plain #anchor scrolls to a closed <details>
// but leaves it shut, so "Mac guide" would land on a one-line heading.

export default function OpenOnHash() {
  useEffect(() => {
    function openTarget() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el && el.tagName === 'DETAILS') {
        el.open = true;
        el.scrollIntoView({ block: 'start' });
      }
    }
    openTarget();
    window.addEventListener('hashchange', openTarget);
    return () => window.removeEventListener('hashchange', openTarget);
  }, []);

  return null;
}
