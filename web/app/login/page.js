import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = { title: 'Sign in · KD Tracker' };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="card-pad">
          <div className="login-head">
            <h1>
              <span className="brand-mark" style={{ display: 'inline-grid', verticalAlign: '-4px', marginRight: 8 }}>
                KD
              </span>
              Tracker
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
