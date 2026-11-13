import { Suspense } from 'react';
import { api, requireUser } from '@/lib/api';
import { daysAgoDate, todayIn } from '@/lib/format';
import RangeFilter from '@/components/RangeFilter';
import Pager from '@/components/Pager';

export const metadata = { title: 'Audit log · WorkInvigilator' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What each recorded action means, in words. An action this list does not know is shown as it is.
const LABELS = {
  viewed_screenshot: 'Opened a screenshot',
  listed_screenshots: 'Listed screenshots',
  viewed_audio: 'Played an audio sample',
  listed_audio: 'Listed audio samples',
  viewed_activity: 'Viewed activity',
  viewed_attendance: 'Viewed attendance',
  exported_report: 'Exported a report',
  exported_payroll: 'Exported payroll',
  generated_payroll: 'Generated payroll',
  created_employee: 'Added an employee',
  updated_employee: 'Changed an employee',
  deactivated_employee: 'Deactivated an employee',
  assigned_leader: 'Made someone a leader',
  removed_leader: 'Removed a leader',
  updated_settings: 'Changed settings',
  reviewed_leave_request: 'Decided a leave request',
  viewed_leave_proof: 'Opened a leave proof file',
  reviewed_time_correction: 'Decided a time correction',
  set_pay_rate: 'Set a pay rate',
  updated_pay_rate: 'Changed a pay rate',
  uploaded_pay_rates: 'Uploaded pay rates',
  added_bonus: 'Added a bonus',
  deleted_bonus: 'Deleted a bonus',
  uploaded_bonuses: 'Uploaded bonuses',
  viewed_payslip: 'Viewed a payslip',
  emailed_payslips: 'Emailed payslips',
  finalized_payroll: 'Finalized payroll',
  reopened_payroll: 'Reopened payroll',
  added_holiday: 'Added a holiday',
  removed_holiday: 'Removed a holiday',
  updated_holiday: 'Changed a holiday',
  uploaded_holidays: 'Uploaded holidays',
  viewed_bank_details: 'Viewed bank details',
  updated_bank_details: 'Saved bank details',
  removed_bank_details: 'Removed bank details',
  granted_account_admin: 'Gave account admin access',
  revoked_account_admin: 'Took away account admin access',
};

// The ones that touch private or pay information, so they stand out in the list.
const SENSITIVE = new Set([
  'viewed_bank_details', 'updated_bank_details', 'removed_bank_details', 'viewed_screenshot', 'viewed_audio',
  'granted_account_admin', 'revoked_account_admin', 'finalized_payroll', 'reopened_payroll', 'exported_payroll',
]);

const label = (action) => LABELS[action] || action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Details as short "key: value" text, with nothing long or nested spilling onto the page. */
function detailText(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ')
    .slice(0, 160);
}

export default async function AuditLogPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });
  const tz = user.timezone;
  const today = todayIn(tz);

  const from = DATE.test(params.from || '') ? params.from : daysAgoDate(6, tz);
  const to = DATE.test(params.to || '') ? params.to : today;
  const action = params.action || '';
  const employeeId = UUID.test(params.employeeId || '') ? params.employeeId : '';
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);

  const query = new URLSearchParams({ from, to, page: String(page), limit: '50' });
  if (action) query.set('action', action);
  if (employeeId) query.set('targetEmployeeId', employeeId);

  const backwards = from > to;
  const soft = (p) => p.catch(() => null);
  const [result, actions, people] = await Promise.all([
    backwards ? Promise.resolve(null) : api(`/api/admin/audit-logs?${query}`),
    soft(api('/api/admin/audit-actions')),
    api('/api/admin/employee-options'),
  ]);

  const time = (ms) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>
            Who looked at or changed sensitive things, and when. Opening a screenshot or someone’s bank details, changing
            settings, deciding leave or pay: each is recorded with the person, the time and where it came from. Entries
            cannot be edited or deleted. Times are New York time.
          </p>
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
                  label: 'What',
                  type: 'select',
                  options: [{ value: '', label: 'Everything' }, ...(actions || []).map((a) => ({ value: a, label: label(a) }))],
                },
                { name: 'employee', label: 'About (employee)', type: 'employee', options: people || [] },
              ]}
            />
          </Suspense>
        </div>

        {backwards && (
          <div className="notice notice-warn" role="alert">
            The From date is after the To date, so there is nothing to show. Put the earlier date in From.
          </div>
        )}

        {result && (
          <div className="card">
            <div className="card-head">
              <h2>{result.pagination.total} {result.pagination.total === 1 ? 'entry' : 'entries'}</h2>
            </div>
            {result.data.length === 0 ? (
              <div className="empty">Nothing was recorded for these filters.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>About</th>
                      <th>Details</th>
                      <th>From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((r) => (
                      <tr key={r.id}>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>{time(new Date(r.timestamp).getTime())}</td>
                        <td>
                          {r.adminName || 'Unknown'}
                          <div className="faint" style={{ fontSize: 11 }}>{r.adminEmail || ''}</div>
                        </td>
                        <td>
                          <span className={`pill ${SENSITIVE.has(r.action) ? 'pill-flag' : 'pill-none'}`}>{label(r.action)}</span>
                        </td>
                        <td>{r.targetName || <span className="faint">—</span>}</td>
                        <td className="muted" style={{ maxWidth: 280, fontSize: 12 }}>{detailText(r.details) || '—'}</td>
                        <td className="faint num" style={{ fontSize: 12 }}>{r.ipAddress || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager pagination={result.pagination} searchParams={{ from, to, action, employeeId }} basePath="/admin/audit" />
          </div>
        )}
      </div>
    </>
  );
}
