'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { NOTIFICATIONS_CHANGED } from '@/components/NotificationBadge';

/** "5 min ago", "yesterday", or a date: how long ago something happened, without a clock. */
function ago(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationList({ items, unreadCount }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function markRead(body) {
    setBusy(true);
    setError(null);
    try {
      await post('/api/notifications/read', body);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(item) {
    if (!item.read) {
      try {
        await post('/api/notifications/read', { ids: [item.id] });
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      } catch {
        // Opening the page matters more than the read mark.
      }
    }
    if (item.link) router.push(item.link);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</h2>
        {unreadCount > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={() => markRead({ all: true })}>
            Mark all as read
          </button>
        )}
      </div>

      {error && (
        <div className="notice notice-danger" style={{ margin: 14 }} role="alert">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">No notifications yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => open(item)}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 18px',
                  border: 0,
                  background: item.read ? 'transparent' : 'var(--accent-soft)',
                  cursor: item.link ? 'pointer' : 'default',
                  font: 'inherit',
                  color: 'inherit',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: 'none',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    marginTop: 7,
                    background: item.read ? 'transparent' : 'var(--accent)',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: item.read ? 500 : 700 }}>{item.title}</span>
                  {item.body && (
                    <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                      {item.body}
                    </span>
                  )}
                </span>
                <span className="faint" style={{ flex: 'none', fontSize: 12 }}>
                  {ago(item.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
