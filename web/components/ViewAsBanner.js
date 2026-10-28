'use client';

import { useState } from 'react';
import { post } from '@/lib/client';

const ROLE = { admin: 'HR / Admin', leader: 'Team leader', user: 'Employee' };

/**
 * Shown on every page while the platform owner is viewing as someone in a company, so it is never
 * unclear whose session this is. Exit returns to the owner's own session.
 */
export default function ViewAsBanner({ user }) {
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    try {
      await post('/impersonate/exit');
    } finally {
      window.location.href = '/super';
    }
  }

  return (
    <div
      className="notice notice-warn"
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 14,
      }}
    >
      <span>
        <strong>Viewing as {user.name}</strong> ({ROLE[user.role] || user.role}
        {user.company?.name ? `, ${user.company.name}` : ''}) as {user.impersonation.by.name}. You can look
        around and use admin tools, but not act as this person. Everything you do is recorded in the
        company&apos;s audit log.
      </span>
      <button type="button" className="btn btn-primary" onClick={exit} disabled={busy}>
        {busy ? 'Exiting…' : 'Exit view-as'}
      </button>
    </div>
  );
}
