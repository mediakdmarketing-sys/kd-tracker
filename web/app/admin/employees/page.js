import { Suspense } from 'react';
import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import Pager from '@/components/Pager';
import NewEmployeeForm from './NewEmployeeForm';
import { dateLabel } from '@/lib/format';

export const metadata = { title: 'Employees · KD Tracker' };

export default async function EmployeesPage({ searchParams }) {
  const params = await searchParams;
  await requireUser({ adminOnly: true });

  const search = params.search || '';
  const status = params.status || '';
  const page = params.page || '1';

  const query = new URLSearchParams({ page, limit: '50' });
  if (search) query.set('search', search);
  if (status) query.set('status', status);

  const [result, departments] = await Promise.all([
    api(`/api/admin/employees?${query}`),
    api('/api/admin/departments'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p>{result.pagination.total} accounts</p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'search', label: 'Search', type: 'text', placeholder: 'Name or email' },
                {
                  name: 'status',
                  label: 'Status',
                  type: 'select',
                  options: [
                    { value: '', label: 'All' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Deactivated' },
                  ],
                },
              ]}
            />
          </Suspense>
        </div>

        <NewEmployeeForm departments={departments} />

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Work email</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Consent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">No employees match.</div>
                    </td>
                  </tr>
                ) : (
                  result.data.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <Link href={`/admin/employees/${employee.id}`}>{employee.name}</Link>
                        {employee.employeeCode ? (
                          <div className="faint mono">{employee.employeeCode}</div>
                        ) : null}
                      </td>
                      <td className="muted">{employee.email}</td>
                      <td className="muted">{employee.department || '—'}</td>
                      <td>
                        <span className={`pill ${
                          employee.role === 'admin' ? 'pill-idle' :
                          employee.role === 'leader' ? 'pill-break' :
                          'pill-out'
                        }`}>
                          {employee.role === 'admin' ? 'HR / Admin' :
                           employee.role === 'leader' ? 'Leader' :
                           'Employee'}
                        </span>
                      </td>
                      <td>
                        {employee.consent.monitoring ? (
                          <div className="inline">
                            <span className="pill pill-working">Monitoring</span>
                            {employee.consent.audio ? (
                              <span className="pill pill-working">Audio</span>
                            ) : (
                              <span className="pill pill-none">No audio</span>
                            )}
                          </div>
                        ) : (
                          <span className="pill pill-flag">Not given</span>
                        )}
                        {employee.consent.givenAt ? (
                          <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                            {dateLabel(employee.consent.givenAt.slice(0, 10))}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`pill ${employee.status === 'active' ? 'pill-working' : 'pill-flag'}`}>
                          {employee.status === 'active' ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager
            pagination={result.pagination}
            searchParams={{ search, status }}
            basePath="/admin/employees"
          />
        </div>
      </div>
    </>
  );
}
