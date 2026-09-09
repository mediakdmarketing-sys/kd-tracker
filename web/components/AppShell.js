import Link from 'next/link';
import NavLink from './NavLink';
import LogoutButton from './LogoutButton';

const USER_NAV = [
  { href: '/me', label: 'My shift' },
  { href: '/me/history', label: 'My history' },
];

const ADMIN_NAV = [
  { href: '/admin', label: 'Live board' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/employees', label: 'Employees' },
  { href: '/admin/departments', label: 'Departments' },
  { href: '/admin/payroll', label: 'Payroll' },
  { href: '/admin/audit', label: 'Audit log' },
];

const LEADER_NAV = [
  { href: '/leader', label: 'My team' },
  { href: '/leader/members', label: 'Live board' },
];

export default function AppShell({ user, children }) {
  const links =
    user.role === 'admin'
      ? [...ADMIN_NAV, ...USER_NAV]
      : user.role === 'leader'
      ? [...LEADER_NAV, ...USER_NAV]
      : USER_NAV;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={user.role === 'admin' ? '/admin' : '/me'} className="brand">
            <span className="brand-mark">KD</span>
            Tracker
          </Link>

          <nav className="nav">
            {links.map((link) => (
              <NavLink key={link.href} href={link.href}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="whoami">
            <div>
              <div className="name">{user.name}</div>
              <div className="role">
                {user.role === 'admin'
                  ? 'HR / Admin'
                  : user.role === 'leader'
                  ? `Team Lead · ${user.department || ''}`
                  : user.department || 'Employee'}
              </div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
