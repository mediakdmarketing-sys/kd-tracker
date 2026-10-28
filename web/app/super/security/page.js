import { api } from '@/lib/api';
import TwoFactorCard from './TwoFactorCard';

export const metadata = { title: 'Security · WorkBuddy' };

export default async function SecurityPage() {
  const me = await api('/api/auth/me');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p>Protect your platform account. It can reach every company, so it should not rely on a password alone.</p>
        </div>
      </div>
      <TwoFactorCard enabled={Boolean(me.twoFactorEnabled)} email={me.email} />
    </>
  );
}
