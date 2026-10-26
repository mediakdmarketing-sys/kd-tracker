import { getSessionUser } from '@/lib/api';
import ChangePasswordForm from './ChangePasswordForm';

export const metadata = { title: 'Choose a password · WorkBuddy' };

export default async function ChangePasswordPage() {
  // Not requireUser(): that sends a person with a temporary password straight back here.
  const user = await getSessionUser();
  const first = String(user.name || '').split(' ')[0];

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="card-pad">
          <div className="login-head">
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" width={44} height={44} />
              <span className="brand-word" style={{ fontSize: 27 }}>WorkBuddy</span>
            </h1>
            <p>
              {user.mustChangePassword
                ? `Welcome${first ? `, ${first}` : ''}! Choose your own password to continue.`
                : 'Choose a new password.'}
            </p>
          </div>
          <ChangePasswordForm temporary={Boolean(user.mustChangePassword)} />
        </div>
      </div>
    </div>
  );
}
