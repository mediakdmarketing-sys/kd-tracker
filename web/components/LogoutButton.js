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
    <button type="button" className="btn" onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
