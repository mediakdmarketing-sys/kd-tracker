import { Suspense } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { duration, formatBytes } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import CompanyControls from './CompanyControls';
import ViewAsList from './ViewAsList';
import BrandingCard from './BrandingCard';
import PlanCard from './PlanCard';
import DomainCard from './DomainCard';
import DangerCard from './DangerCard';
import UsageChart from './UsageChart';

export const metadata = { title: 'Company · WorkBuddy' };

export default async function CompanyPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const qs = new URLSearchParams();
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  const [me, usage, company, admins, people] = await Promise.all([
    api('/api/auth/me'),
    api(`/api/super/companies/${id}/usage?days=30`),
    api(`/api/super/companies/${id}${qs.size ? `?${qs}` : ''}`),
    api(`/api/super/companies/${id}/admins`),
    api(`/api/super/companies/${id}/people`),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{company.name}</h1>
          <p>
            {company.employees} active people · {company.admins} admin{company.admins === 1 ? '' : 's'}{' '}
            <Link href="/super" className="btn" style={{ marginLeft: 8 }}>
              ← All companies
            </Link>
          </p>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <Suspense fallback={null}>
          <RangeFilter
            fields={[
              { name: 'from', label: 'From', type: 'date', defaultValue: query.from || '' },
              { name: 'to', label: 'To', type: 'date', defaultValue: query.to || '' },
            ]}
          />
        </Suspense>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Active people</div>
          <div className="value">
            {company.employees}
            {company.maxEmployees ? ` / ${company.maxEmployees}` : ''}
          </div>
          <div className="sub">{company.workingNow} working now</div>
        </div>
        <div className="stat">
          <div className="label">Storage used</div>
          <div className="value">
            {formatBytes(company.storage.bytes)}
            {company.storageLimitBytes ? ` / ${formatBytes(company.storageLimitBytes)}` : ''}
          </div>
          <div className="sub">
            {company.storage.files} files · screenshots {formatBytes(company.storage.screenshots)} · audio{' '}
            {formatBytes(company.storage.audio)} · proofs {formatBytes(company.storage.proofs)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Worked this month</div>
          <div className="value">{duration(company.hours.thisMonth.workedSeconds)}</div>
          <div className="sub">{duration(company.hours.thisMonth.breakSeconds)} on break</div>
        </div>
        {company.hours.range && (
          <div className="stat">
            <div className="label">Selected range</div>
            <div className="value">{duration(company.hours.range.workedSeconds)}</div>
            <div className="sub">{duration(company.hours.range.breakSeconds)} on break</div>
          </div>
        )}
        <div className="stat">
          <div className="label">Worked, all time</div>
          <div className="value">{duration(company.hours.allTime.workedSeconds)}</div>
          <div className="sub">{duration(company.hours.allTime.breakSeconds)} on break</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <UsageChart usage={usage} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <ViewAsList people={people} suspended={company.status !== 'active'} />
      </div>

      {/* Support staff can look and view as a person; everything below is the owner's to change. */}
      <fieldset disabled={me.platformRole !== 'owner'} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="stack">
          <PlanCard key={`${company.plan}-${company.trialEndsAt}-${company.autoSuspend}`} company={company} />
          <BrandingCard key={`${company.slug}-${company.brand.version}`} company={company} />
          <DomainCard key={`${company.customDomain}-${company.customDomainVerified}`} company={company} />
          <CompanyControls company={company} admins={admins} />
          <div className="card card-pad">
            <Link href={`/super/companies/${id}/settings`} className="btn">
              Shift, break &amp; retention defaults →
            </Link>
          </div>
          <DangerCard company={company} />
        </div>
      </fieldset>
    </>
  );
}
