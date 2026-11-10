import { requireUser } from '@/lib/api';
import AppShell from '@/components/AppShell';

// The calendar is for every signed-in role, so it sits outside /admin, /leader and /me. Without a
// layout of its own it was drawn with no sidebar, like a page that had left the app.
export default async function CalendarLayout({ children }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
