import Link from 'next/link';
import { api } from '@/lib/api';
import SettingsForm from '@/app/admin/settings/SettingsForm';

export const metadata = { title: 'Company defaults · WorkBuddy' };

export default async function CompanyDefaultsPage({ params }) {
  const { id } = await params;
  const [company, settings, me] = await Promise.all([
    api(`/api/super/companies/${id}`),
    api(`/api/super/companies/${id}/settings`),
    api('/api/auth/me'),
  ]);
  const canEdit = me.platformRole === 'owner';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{company.name}: defaults</h1>
          <p>
            Shift, break, day lengths and retention for this company. Its HR can change the same values later in their
            own Settings.{' '}
            <Link href={`/super/companies/${id}`} className="btn" style={{ marginLeft: 8 }}>
              ← Back to company
            </Link>
          </p>
        </div>
      </div>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SettingsForm initial={settings} features={company.features} endpoint={`/api/super/companies/${id}/settings`} />
      </fieldset>
    </>
  );
}
