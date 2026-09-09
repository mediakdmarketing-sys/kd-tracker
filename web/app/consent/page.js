import { getSessionUser, api } from '@/lib/api';
import ConsentForm from './ConsentForm';

export const metadata = { title: 'What we monitor · KD Tracker' };

/**
 * Story W-3. This page stands between an employee and their first punch-in, and the text on it
 * comes from the API rather than the client, so what is disclosed cannot drift away from what
 * the backend actually does.
 */
export default async function ConsentPage() {
  const [user, disclosure] = await Promise.all([getSessionUser(), api('/api/auth/consent')]);

  return (
    <div className="login-wrap" style={{ alignItems: 'flex-start', paddingTop: 48 }}>
      <div className="card" style={{ maxWidth: 680, width: '100%' }}>
        <div className="card-pad">
          <h1>What this system records</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Please read this before starting your first shift. Version {disclosure.version}.
          </p>

          <div className="stack" style={{ marginTop: 20 }}>
            {disclosure.captured.map((item) => (
              <div key={item.key} className="card" style={{ boxShadow: 'none' }}>
                <div className="card-pad" style={{ padding: 14 }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <h3>{item.title}</h3>
                    <span className={`pill ${item.required ? 'pill-out' : 'pill-idle'}`}>
                      {item.required ? 'Part of the monitoring policy' : 'Optional — your choice'}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="stack" style={{ marginTop: 18 }}>
            <div className="notice notice-info">
              <strong>How long it is kept.</strong> {disclosure.retention}
            </div>
            <div className="notice notice-info">
              <strong>Who can see it.</strong> {disclosure.access}
            </div>
            <div className="notice notice-info">
              <strong>What it is used for.</strong> {disclosure.purpose}
            </div>
          </div>

          <ConsentForm user={user} />
        </div>
      </div>
    </div>
  );
}
