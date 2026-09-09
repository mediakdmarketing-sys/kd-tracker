import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default async function LeaderLayout({ children }) {
  const user = await requireUser();
  // Only leaders and admins can access the leader section.
  if (user.role !== 'leader' && user.role !== 'admin') redirect('/me');
  return <AppShell user={user}>{children}</AppShell>;
}
