import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default async function HelpLayout({ children }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
