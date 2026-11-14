'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';
import useSSE from '@/lib/useSSE';

// The unread count shown next to "Notifications" in the sidebar.
// Instant update when the server pushes a `notification` SSE event.
// Falls back to a 60-second poll when SSE is unavailable.

export const NOTIFICATIONS_CHANGED = 'workbuddy:notifications';

export default function NotificationBadge() {
  const [count, setCount] = useState(0);
  const lastSseEventRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await call('/api/notifications?limit=1');
      setCount(data.unreadCount || 0);
    } catch {
      // A missed poll is not worth showing; the next one will recover.
    }
  }, []);

  // SSE: a new notification was just created → fetch the updated count immediately.
  useSSE('notification', useCallback(() => {
    lastSseEventRef.current = Date.now();
    load();
  }, [load]));

  useEffect(() => {
    load();

    // Fallback poll — only fires if SSE hasn't delivered a notification event recently.
    const FALLBACK_MS = 60_000;
    const timer = setInterval(() => {
      const lastSse = lastSseEventRef.current;
      const sseIsLive = lastSse && Date.now() - lastSse < FALLBACK_MS * 3;
      if (!sseIsLive) load();
    }, FALLBACK_MS);

    // Also refresh when another component (NotificationList) marks items read.
    window.addEventListener(NOTIFICATIONS_CHANGED, load);

    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [load]);

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
