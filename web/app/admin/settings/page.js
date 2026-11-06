import { api, requireUser } from '@/lib/api';
import SettingsForm from './SettingsForm';
import BrandingCard from './BrandingCard';
import PayslipTemplateCard from './PayslipTemplateCard';

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

      <div className="stack">
        <BrandingCard company={settings.company} emailConfigured={Boolean(settings.email?.configured)} />
        <PayslipTemplateCard template={settings.payslip} defaults={settings.payslipDefaults} company={settings.company} />
        <SettingsForm initial={settings} />
      </div>
    </>
  );
}
