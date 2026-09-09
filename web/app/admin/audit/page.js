import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import Pager from '@/components/Pager';
import { time, dateLabel, daysAgoDate, todayIn } from '@/lib/format';

export const metadata = { title: 'Audit log · KD Tracker' };

const ACTION_LABEL = {
  viewed_screenshot: 'Opened a screenshot',
  listed_screenshots: 'Listed screenshots',
  viewed_audio: 'Played an audio sample',
  listed_audio: 'Listed audio samples',
  viewed_attendance: 'Viewed attendance history',
  exported_report: 'Exported a report',
  exported_payroll: 'Exported payroll',
  generated_payroll: 'Generated payroll',
  created_employee: 'Created an employee',
  updated_employee: 'Updated an employee',
  deactivated_employee: 'Deactivated an employee',
};

const SENSITIVE = new Set(['viewed_screenshot', 'viewed_audio']);

/**
 * Render audit details as readable key: value pairs instead of a raw JSON string.
 * Null / undefined values are omitted so the cell stays tidy.
 */
function DetailCell({ action, details }) {
  if (!details) return <span className="faint">—</span>;

  // Build a list of the most useful fields for each action type.
  const pairs = [];

  if (details.from || details.to) {
    pairs.push(`${details.from || '?'} → ${details.to || '?'}`);
  }
  if (details.date) pairs.push(`date: ${details.date}`);
  if (details.department) pairs.push(`dept: ${details.department}`);
  if (details.format) pairs.push(`format: ${details.format}`);
  if (details.rows != null) pairs.push(`${details.rows} rows`);
  if (details.count != null) pairs.push(`${details.count} items`);
  if (details.email) pairs.push(details.email);
  if (details.role) pairs.push(`role: ${details.role}`);
  if (details.fields?.length) pairs.push(`changed: ${details.fields.join(', ')}`);
  if (details.month) pairs.push(`month: ${details.month}`);
  if (details.capturedAt) pairs.push(`captured: ${details.capturedAt}`);
  if (details.recordedAt) pairs.push(`recorded: ${details.recordedAt}`);

  // If we have nothing recognisable, fall back to a compact JSON so no info is lost.
  if (pairs.length === 0) {
    return (
      <span className="muted mono" style={{ fontSize: 11 }}>
        {JSON.stringify(details)}
      </span>
    );
  }

  return (
    <span className="muted" style={{ fontSize: 12 }}>
      {pairs.join(' · ')}
    </span>
  );
}

export default async function AuditPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });

  const from = params.from || daysAgoDate(7, user.timezone);
  const to = params.to || todayIn(user.timezone);
  const action = params.action || '';
  const page = params.page || '1';

  const query = new URLSearchParams({ from, to, page, limit: '50' });
  if (action) query.set('action', action);

  const result = await api(`/api/admin/audit-logs?${query}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Every admin access to employee monitoring data. Append-only — nothing here can be edited or deleted.</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                {
                  name: 'action',
                  label: 'Action',
                  type: 'select',
                  options: [
                    { value: '', label: 'All actions' },
                    ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
                  ],
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
                  <th>Admin</th>
                  <th>Action</th>
                  <th>About</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {result.data.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">No audit entries in this range.</div>
                    </td>
                  </tr>
                ) : (
                  result.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="num">
                        {dateLabel(entry.timestamp)}
                        <div className="faint">{time(entry.timestamp, user.timezone)}</div>
                      </td>
                      <td>
                        {entry.adminName}
                        <div className="faint">{entry.adminEmail}</div>
                      </td>
                      <td>
                        <span className={`pill ${SENSITIVE.has(entry.action) ? 'pill-flag' : 'pill-out'}`}>
                          {ACTION_LABEL[entry.action] || entry.action}
                        </span>
                      </td>
                      <td>
                        {entry.targetEmployeeId ? (
                          <Link href={`/admin/employees/${entry.targetEmployeeId}`}>Employee</Link>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <DetailCell action={entry.action} details={entry.details} />
                      </td>
                      <td className="faint" style={{ fontSize: 12 }}>
                        {entry.ipAddress === '::1' || entry.ipAddress === '127.0.0.1'
                          ? 'localhost'
                          : entry.ipAddress || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager
            pagination={result.pagination}
            searchParams={{ from, to, action }}
            basePath="/admin/audit"
          />
        </div>
      </div>
    </>
  );
}
