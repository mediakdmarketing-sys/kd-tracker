import { api, requireUser } from '@/lib/api';
import TwoStepCard from './TwoStepCard';
import SessionsCard from './SessionsCard';
import LoginHistoryTable from '@/components/LoginHistoryTable';

export const metadata = { title: 'Security · WorkInvigilator' };

export default async function SecurityPage() {
  const user = await requireUser({ allowTwoFactorSetup: true });
  const [security, sessions, history] = await Promise.all([
    api('/api/auth/security'),
    api('/api/auth/sessions'),
    api('/api/auth/login-history'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p>Protect your account: two-step sign-in, where you are signed in, and your recent sign-ins.</p>
        </div>
      </div>

      <div className="stack">
        <TwoStepCard status={security.twoFactor} />
        <SessionsCard sessions={sessions} timezone={user.timezone} />

        <div className="card">
          <div className="card-head">
            <h2>Recent sign-ins</h2>
            <span className="faint">Including attempts that failed. You are told when a device you have not used before signs in.</span>
          </div>
          <LoginHistoryTable history={history} timezone={user.timezone} />
        </div>
      </div>
    </>
  );
}
