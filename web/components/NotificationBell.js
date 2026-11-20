'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { call, post } from '@/lib/client';
import useSSE from '@/lib/useSSE';
import { NOTIFICATIONS_CHANGED } from './NotificationBadge';
import { ago } from './NotificationList';

const SHOW = 8;
const FALLBACK_MS = 60_000;

/**
 * The bell in the top bar. The red number is the unread count; clicking opens a frosted-glass panel
 * with the latest notifications, so they can be read and cleared without leaving the page.
 * Updates the moment the server pushes one (SSE), and falls back to a minute-by-minute check.
 */
export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef(null);
  const lastPush = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await call(`/api/notifications?limit=${SHOW}`);
      setItems(data.items || []);
      setUnread(data.unreadCount || 0);
      setLoaded(true);
    } catch {
      // A missed refresh is not worth showing; the next one recovers.
    }
  }, []);

  useSSE('notification', useCallback(() => { lastPush.current = Date.now(); load(); }, [load]));

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      const sseIsLive = lastPush.current && Date.now() - lastPush.current < FALLBACK_MS * 3;
      if (!sseIsLive) load();
    }, FALLBACK_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [load]);

  // Closes on a click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function markRead(body) {
    setBusy(true);
    try {
      await post('/api/notifications/read', body);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); // also refreshes the sidebar count
    } catch {
      // Reading matters more than the mark.
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item) {
    setOpen(false);
    if (!item.read) await markRead({ ids: [item.id] });
    if (item.link) router.push(item.link);
  }

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="bell-btn"
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-pop glass" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>{unread > 0 ? `${unread} unread` : 'All caught up'}</strong>
            {unread > 0 && (
              <button type="button" className="linklike" disabled={busy} onClick={() => markRead({ all: true })}>
                Mark all as read
              </button>
            )}
          </div>

          {!loaded ? (
            <div className="bell-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="bell-empty">No notifications yet.</div>
          ) : (
            <ul className="bell-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`bell-item${item.read ? '' : ' unread'}`} onClick={() => openItem(item)}>
                    <span className="bell-dot" aria-hidden="true" />
                    <span className="bell-text">
                      <span className="bell-title">{item.title}</span>
                      {item.body && <span className="bell-body">{item.body}</span>}
                    </span>
                    <span className="bell-ago">{ago(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="bell-foot">
            <Link href="/notifications" onClick={() => setOpen(false)}>View all notifications</Link>
          </div>
        </div>
      )}
    </div>
  );
}
