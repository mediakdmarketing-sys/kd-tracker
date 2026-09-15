'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await post('/logout');
    } finally {
      // Even if revoking failed server-side, the cookies are cleared — get out of the session.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="btn"
      onClick={signOut}
      disabled={busy}
      title="Sign out"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
      <span>{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
