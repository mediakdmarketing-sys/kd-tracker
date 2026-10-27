import { Suspense } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { duration, formatBytes } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import CompanyControls from './CompanyControls';

export const metadata = { title: 'Company · WorkBuddy' };

export default async function CompanyPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const qs = new URLSearchParams();
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  const [company, admins] = await Promise.all([
    api(`/api/super/companies/${id}${qs.size ? `?${qs}` : ''}`),
    api(`/api/super/companies/${id}/admins`),
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

      <CompanyControls company={company} admins={admins} />
    </>
  );
}
