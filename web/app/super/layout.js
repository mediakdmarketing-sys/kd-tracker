import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default async function SuperLayout({ children }) {
  // Platform owner only: enforced here for the pages and again by the API on every call.
  const user = await requireUser({ superOnly: true });
  return <AppShell user={user}>{children}</AppShell>;
}
