import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import StaffManager from './StaffManager';

export const metadata = { title: 'Platform staff · WorkBuddy' };

export default async function StaffPage() {
  const me = await api('/api/auth/me');
  // Only the owner manages staff; support accounts do not even see this page.
  if (me.platformRole !== 'owner') redirect('/super');
  const staff = await api('/api/super/staff');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform staff</h1>
          <p>People who can help customers. Support staff can look at every company and view as a person, but change nothing.</p>
        </div>
      </div>
      <StaffManager staff={staff} meId={me.id} />
    </>
  );
}
