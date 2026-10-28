'use client';

import { useEffect, useState } from 'react';

const KEY = 'kd_dismissed_announcements';

function readDismissed() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Messages at the top of every page: announcements from the platform (dismissable, remembered in
 * this browser) and, for a company's HR, a warning when the free trial is about to end.
 */
export default function NoticeBanners({ announcements = [], trialEndsAt, isAdmin }) {
  const [dismissed, setDismissed] = useState([]);
  useEffect(() => setDismissed(readDismissed()), []);

  function dismiss(id) {
    const next = [...new Set([...dismissed, id])].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* the banner just comes back next visit */
    }
  }

  const left = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const showTrial = isAdmin && left !== null && left <= 7;
  const shown = announcements.filter((a) => !dismissed.includes(a.id));
  if (!showTrial && shown.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
      {showTrial && (
        <div className="notice notice-warn" role="status">
          {left > 0
            ? `Your free trial ends in ${left} day${left === 1 ? '' : 's'}. Contact your provider to keep using WorkBuddy.`
            : 'Your free trial has ended. Contact your provider to keep using WorkBuddy.'}
        </div>
      )}
      {shown.map((a) => (
        <div
          key={a.id}
          className={`notice ${a.level === 'warn' ? 'notice-warn' : 'notice-info'}`}
          role="status"
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}
        >
          <span>{a.message}</span>
          <button type="button" className="btn" onClick={() => dismiss(a.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
