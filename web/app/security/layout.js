import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

// Security is for every signed-in role, so it sits outside /admin, /leader and /me. An admin whom HR
// requires to use two-step sign-in is sent here first, so this page must not send them away again.
export default async function SecurityLayout({ children }) {
  const user = await requireUser({ allowTwoFactorSetup: true });
  return <AppShell user={user}>{children}</AppShell>;
}
