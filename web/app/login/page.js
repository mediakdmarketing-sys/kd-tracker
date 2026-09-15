import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = { title: 'Sign in · WorkBuddy' };

export default function LoginPage() {
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
            <p>Sign in with your work email.</p>
          </div>
          {/* LoginForm reads the ?next= param, which needs a Suspense boundary to prerender. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
