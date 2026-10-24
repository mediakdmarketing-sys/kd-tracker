'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/client';

// The unread count shown next to "Notifications" in the sidebar. Re-reads every minute, and
// straight away when the notifications page marks things read.

export const NOTIFICATIONS_CHANGED = 'workbuddy:notifications';

export default function NotificationBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stopped = false;

    async function load() {
      try {
        const data = await call('/api/notifications?limit=1');
        if (!stopped) setCount(data.unreadCount || 0);
      } catch {
        // A missed poll is not worth showing; the next one will recover.
      }
    }

    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, []);

  if (!count) return null;
  return (
    <span
      aria-label={`${count} unread`}
      style={{
        marginLeft: 'auto',
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        borderRadius: 999,
        background: 'var(--danger)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        display: 'inline-grid',
        placeItems: 'center',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
