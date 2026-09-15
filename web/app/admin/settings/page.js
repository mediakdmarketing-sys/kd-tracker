import { api, requireUser } from '@/lib/api';
import SettingsForm from './SettingsForm';

export const metadata = { title: 'Settings · WorkBuddy' };

export default async function AdminSettingsPage() {
  const [, settings] = await Promise.all([
    requireUser({ adminOnly: true }),
    api('/api/admin/settings'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>
            Screenshot and audio cadence, shift rules, retention, and payroll — global for the
            whole team. Deploy-time settings (database, storage, security) live in the server
            environment, not here.
          </p>
        </div>
      </div>

      <SettingsForm initial={settings} />
    </>
  );
}
