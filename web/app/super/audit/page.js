import { Suspense } from 'react';
import { api } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import Pager from '@/components/Pager';

export const metadata = { title: 'Platform audit · WorkBuddy' };

const LABEL = {
  company_created: 'Company created',
  company_updated: 'Company changed',
  company_suspended: 'Company suspended',
  company_reactivated: 'Company reactivated',
  company_exported: 'Company exported',
  company_deleted: 'Company deleted',
  branding_updated: 'Branding changed',
  settings_updated: 'Settings changed',
  domain_set: 'Domain set',
  domain_checked: 'Domain checked',
  view_as_started: 'Viewed as a person',
  admin_password_reset: 'Admin password reset',
  staff_created: 'Support staff added',
  staff_removed: 'Support staff removed',
  staff_password_reset: 'Staff password reset',
  announcement_created: 'Announcement posted',
  announcement_ended: 'Announcement ended',
};

/** One line of what changed, in words a person can read. */
function summary(row) {
  const d = row.details;
  if (!d) return '';
  if (d.changed) {
    return Object.entries(d.changed)
      .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  }
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default async function PlatformAuditPage({ searchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.companyId) qs.set('companyId', params.companyId);
  if (params.action) qs.set('action', params.action);
  if (params.page) qs.set('page', params.page);

  const [log, companies] = await Promise.all([
    api(`/api/super/audit${qs.size ? `?${qs}` : ''}`),
    api('/api/super/companies'),
  ]);
  const totalPages = Math.max(1, Math.ceil(log.total / log.limit));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform audit</h1>
          <p>What the platform staff did: companies, plans, people, views into a company, deletions.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                {
                  name: 'companyId',
                  label: 'Company',
                  type: 'select',
                  options: [{ value: '', label: 'All companies' }, ...companies.map((c) => ({ value: c.id, label: c.name }))],
                },
                {
                  name: 'action',
                  label: 'Action',
                  type: 'select',
                  options: [{ value: '', label: 'All actions' }, ...Object.entries(LABEL).map(([value, label]) => ({ value, label }))],
                },
              ]}
            />
          </Suspense>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Company</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">Nothing recorded yet.</div>
                    </td>
                  </tr>
                ) : (
                  log.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(r.timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td>{r.actorName || '—'}</td>
                      <td>{LABEL[r.action] || r.action}</td>
                      <td>{r.companyName || '—'}</td>
                      <td className="muted" style={{ fontSize: 12.5, maxWidth: 420, wordBreak: 'break-word' }}>
                        {summary(r)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager
            pagination={{ page: log.page, totalPages, total: log.total }}
            searchParams={params}
            basePath="/super/audit"
          />
        </div>
      </div>
    </>
  );
}
