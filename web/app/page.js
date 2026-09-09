import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/api';

// Landing route: send people where they actually work.
export default async function Home() {
  const user = await getSessionUser();
  if (user.consent.required) redirect('/consent');
  redirect(user.role === 'admin' ? '/admin' : '/me');
}
