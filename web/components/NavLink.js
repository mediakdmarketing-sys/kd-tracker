'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLink({ href, children }) {
  const pathname = usePathname();
  // "/admin" must not light up for "/admin/reports", but "/admin/employees" should stay lit
  // on "/admin/employees/<id>".
  const active = pathname === href || (href !== '/admin' && href !== '/me' && pathname.startsWith(`${href}/`));

  return (
    <Link href={href} className={active ? 'active' : undefined}>
      {children}
    </Link>
  );
}
