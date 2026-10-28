import { Suspense } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FEATURE_LIST } from '@/lib/features';
import { duration, formatBytes, daysAgoDate, todayIn } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import CreateCompanyForm from './CreateCompanyForm';

export const metadata = { title: 'Companies · WorkBuddy' };

/** Used / limit, turning to a warning from 90%. */
function Storage({ storage, limit }) {
  const pct = limit ? Math.min(100, Math.round((storage.bytes / limit) * 100)) : null;
  const hot = pct !== null && pct >= 90;
  return (
    <td className="num">
      <span style={hot ? { color: 'var(--danger, #b42318)', fontWeight: 650 } : undefined}>
        {formatBytes(storage.bytes)}
        {limit ? ` / ${formatBytes(limit)}` : ''}
      </span>
      <div className="faint" style={{ fontSize: 12 }}>
        {pct !== null ? `${pct}% used · ` : ''}
        {storage.files} files
      </div>
    </td>
  );
}

export default async function CompaniesPage({ searchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const ranged = qs.size > 0;

  const companies = await api(`/api/super/companies${ranged ? `?${qs}` : ''}`);

  const today = todayIn();
  const presets = [
    { label: 'This month', href: '/super' },
    { label: 'Today', href: `/super?from=${today}&to=${today}` },
    { label: 'Last 7 days', href: `/super?from=${daysAgoDate(6)}&to=${today}` },
    { label: 'Last 30 days', href: `/super?from=${daysAgoDate(29)}&to=${today}` },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p>Every company using WorkBuddy, and what each one may use.</p>
        </div>
      </div>

      <div className="stack">
        <CreateCompanyForm />

        <div className="card card-pad">
          <div className="inline" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {presets.map((p) => (
              <Link key={p.label} href={p.href} className="btn">
                {p.label}
              </Link>
            ))}
          </div>
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: params.from || '' },
                { name: 'to', label: 'To', type: 'date', defaultValue: params.to || '' },
              ]}
            />
          </Suspense>
          <p className="faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Hours include shifts still running, counted up to now.
          </p>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Active people</th>
                  <th>Storage</th>
                  <th>{ranged ? 'Selected range' : 'This month'}</th>
                  <th>Time zone</th>
                  <th>Features</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const hours = ranged && c.hours.range ? c.hours.range : c.hours.thisMonth;
                  return (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <div className="faint" style={{ fontSize: 12 }}>{c.slug}</div>
                      </td>
                      <td>
                        <span className={`pill ${c.status === 'active' ? 'pill-working' : 'pill-out'}`}>
                          {c.status}
                        </span>{' '}
                        <span className="pill pill-idle">{c.plan}</span>
                        {c.trialExpired ? (
                          <div className="faint" style={{ fontSize: 12, color: 'var(--danger, #b42318)' }}>
                            trial ended{c.autoSuspend ? ': blocked' : ''}
                          </div>
                        ) : c.trialEndsAt ? (
                          <div className="faint" style={{ fontSize: 12 }}>
                            trial: {Math.ceil((c.trialEndsAt - Date.now()) / 86400000)} days left
                          </div>
                        ) : null}
                      </td>
                      <td className="num">
                        {c.employees}
                        {c.maxEmployees ? ` / ${c.maxEmployees}` : ''}
                        <div className="faint" style={{ fontSize: 12 }}>{c.workingNow} working now</div>
                      </td>
                      <Storage storage={c.storage} limit={c.storageLimitBytes} />
                      <td className="num">
                        {duration(hours.workedSeconds)} worked
                        <div className="faint" style={{ fontSize: 12 }}>{duration(hours.breakSeconds)} break</div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>{c.timezone}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {FEATURE_LIST.filter((f) => c.features[f.key]).map((f) => f.label).join(', ') ||
                          'Time tracking only'}
                      </td>
                      <td>
                        <Link href={`/super/companies/${c.id}`} className="btn">
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
