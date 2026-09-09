import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default async function AdminLayout({ children }) {
  // adminOnly is enforced here and again by the API on every request. This layer only keeps
  // the wrong pages from rendering; it is not the security boundary.
  const user = await requireUser({ adminOnly: true });
  return <AppShell user={user}>{children}</AppShell>;
}
