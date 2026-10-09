'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavLink from './NavLink';
import LogoutButton from './LogoutButton';
import BackButton from './BackButton';

const COLLAPSE_KEY = 'kd_sidebar_collapsed';
const COLLAPSE_WIDTH_PX = 900; // matches the old auto-collapse breakpoint, now just the default

// The bracket-and-bar glyph Hubstaff itself uses (a rounded rectangle split by a vertical
// line, with a small arrowhead in the wider panel showing which way the toggle slides) —
// mirrored left/right by state, not swapped for a different icon.
function PanelToggleIcon({ collapsed }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={collapsed ? { transform: 'scaleX(-1)' } : undefined}
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <path d="M15 9l-3 3 3 3" />
    </svg>
  );
}

// Small inline icon set — one file, no icon-library dependency for a dozen glyphs.
const Icon = {
  board: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </svg>
  ),
  productivity: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 12l5-5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  ),
  reports: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-6 4 3 5-8" />
    </svg>
  ),
  employees: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  departments: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  projects: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  ),
  payroll: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  audit: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  me: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  ),
  history: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  team: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  leave: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
};

// Grouped so related pages sit together — matches how the nav reads, not an arbitrary split.
const ADMIN_GROUPS = [
  {
    label: 'Overview',
    links: [
      { href: '/admin', label: 'Live board', icon: Icon.board },
      { href: '/admin/productivity', label: 'Productivity', icon: Icon.productivity },
      { href: '/admin/reports', label: 'Reports', icon: Icon.reports },
    ],
  },
  {
    label: 'People',
    links: [
      { href: '/admin/employees', label: 'Employees', icon: Icon.employees },
      { href: '/admin/departments', label: 'Departments', icon: Icon.departments },
      { href: '/admin/projects', label: 'Projects', icon: Icon.projects },
    ],
  },
  {
    label: 'Operations',
    links: [
      { href: '/admin/payroll', label: 'Payroll', icon: Icon.payroll },
      { href: '/admin/leave', label: 'Leave requests', icon: Icon.leave },
      { href: '/admin/audit', label: 'Audit log', icon: Icon.audit },
      { href: '/admin/settings', label: 'Settings', icon: Icon.settings },
    ],
  },
];

const LEADER_GROUPS = [
  {
    label: 'Team',
    links: [
      { href: '/leader', label: 'My team', icon: Icon.team },
      { href: '/leader/members', label: 'Live board', icon: Icon.board },
      { href: '/leader/leave', label: 'Leave requests', icon: Icon.leave },
    ],
  },
];

const USER_GROUP = {
  label: 'Me',
  links: [
    { href: '/me', label: 'My shift', icon: Icon.me },
    { href: '/me/history', label: 'My history', icon: Icon.history },
    { href: '/me/leave', label: 'Leave', icon: Icon.leave },
  ],
};

export default function AppShell({ user, children }) {
  // Starts uncollapsed on the server render (no way to know viewport/localStorage there) and
  // corrects itself on mount — same one-frame flash every client-only-preference UI has, not
  // worth a cookie round-trip to avoid for a nav width.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let stored = null;
    try {
      stored = localStorage.getItem(COLLAPSE_KEY);
    } catch {
      // Private browsing / storage disabled — fall through to the width-based default.
    }
    if (stored !== null) {
      setCollapsed(stored === '1');
    } else {
      setCollapsed(window.innerWidth < COLLAPSE_WIDTH_PX);
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Nothing to persist to — the toggle still works for this page view.
      }
      return next;
    });
  }

  // "Me" leads for every role, with "Team" sitting right after it for a Leader — the
  // account's own shift/leave links are what a person reaches for first when they open
  // the app, ahead of the department- or company-wide sections below them.
  const groups =
    user.role === 'admin'
      ? [USER_GROUP, ...ADMIN_GROUPS]
      : user.role === 'leader'
      ? [USER_GROUP, ...LEADER_GROUPS]
      : [{ ...USER_GROUP, label: null }];

  const initials = (user.name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="shell">
      <div className="sidebar-rail">
        <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="brand-row">
            <Link href={user.role === 'admin' ? '/admin' : user.role === 'leader' ? '/leader' : '/me'} className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" className="brand-mark" />
              <span className="brand-word">WorkBuddy</span>
            </Link>
          </div>

          {groups.map((group) => (
            <div key={group.label || 'nav'}>
              {group.label && <div className="nav-group-label">{group.label}</div>}
              <nav className="nav">
                {group.links.map((link) => (
                  <NavLink key={link.href} href={link.href}>
                    {link.icon}
                    <span>{link.label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}

          <div className="sidebar-foot">
            <div className="inline" style={{ width: '100%' }}>
              <div className="avatar">{initials}</div>
              <div className="whoami">
                <div className="name">{user.name}</div>
                <div className="role">
                  {user.role === 'admin'
                    ? 'HR / Admin'
                    : user.role === 'leader'
                    ? `Team Lead · ${user.department || ''}`
                    : user.department || 'Employee'}
                </div>
              </div>
            </div>
            <LogoutButton />
          </div>
        </aside>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <PanelToggleIcon collapsed={collapsed} />
        </button>
      </div>

      <main className="main">
        <BackButton />
        {children}
      </main>
    </div>
  );
}
