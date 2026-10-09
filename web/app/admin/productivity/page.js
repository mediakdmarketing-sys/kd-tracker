import { Suspense } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import RangeFilter from '@/components/RangeFilter';
import { duration, daysAgoDate, todayIn, dateLabel } from '@/lib/format';
import CategoryEditor from './CategoryEditor';

export const metadata = { title: 'Productivity · WorkBuddy' };

const BAND_LABEL = { great: 'Great', good: 'Good', average: 'Average', review: 'Review' };
const BAND_PILL = {
  great: 'pill-working',
  good: 'pill-working',
  average: 'pill-break',
  review: 'pill-flag',
};

// Mirrors the server's bands (productivity.service.js) so the headline number and the table
// agree. 'great' and 'good' share the green style.
const scoreBand = (s) => (s >= 60 ? 'good' : s >= 50 ? 'average' : 'review');

function Presets({ active, department }) {
  const today = todayIn();
  const presets = [
    { label: 'Today', from: today },
    { label: '7 days', from: daysAgoDate(7) },
    { label: '30 days', from: daysAgoDate(30) },
  ];
  return (
    <div className="presets">
      {presets.map((p) => {
        const href = `?${new URLSearchParams({ from: p.from, to: today, ...(department ? { department } : {}) })}`;
        const on = active.from === p.from && active.to === today;
        return (
          <Link key={p.label} href={href} className={`preset${on ? ' active' : ''}`}>
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

function Score({ value, band }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  return (
    <span className={`score s-${band}`}>
      <span className="track">
        <span style={{ width: `${value}%` }} />
      </span>
      {value}%
    </span>
  );
}

function Mix({ mix }) {
  return (
    <div className="mix" title={`${mix.productive}% productive · ${mix.neutral}% neutral · ${mix.distracting}% distracting`}>
      <span className="m-productive" style={{ width: `${mix.productive}%` }} />
      <span className="m-neutral" style={{ width: `${mix.neutral}%` }} />
      <span className="m-distracting" style={{ width: `${mix.distracting}%` }} />
    </div>
  );
}

export default async function ProductivityPage({ searchParams }) {
  const params = await searchParams;

  const from = params.from || daysAgoDate(7);
  const to = params.to || todayIn();
  const department = params.department || '';

  const query = new URLSearchParams({ from, to, ...(department ? { department } : {}) });

  // requireUser({ adminOnly }) already ran in the admin layout.
  const [departments, data, apps] = await Promise.all([
    api('/api/admin/departments'),
    api(`/api/admin/productivity?${query}`),
    api('/api/admin/app-categories'),
  ]);

  const { summary } = data;
  const topSeconds = Math.max(...data.apps.map((a) => a.seconds), 1);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Productivity</h1>
          <p>
            {dateLabel(from)} — {dateLabel(to)}
            {department ? ` · ${department}` : ''}
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Presets active={{ from, to }} department={department} />
          <Suspense fallback={null}>
            <RangeFilter
              fields={[
                { name: 'from', label: 'From', type: 'date', defaultValue: from },
                { name: 'to', label: 'To', type: 'date', defaultValue: to },
                {
                  name: 'department',
                  label: 'Department',
                  type: 'select',
                  options: [
                    { value: '', label: 'All departments' },
                    ...departments.map((d) => ({ value: d, label: d })),
                  ],
                },
              ]}
            />
          </Suspense>
        </div>

        <p className="hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 12h1v5h1" />
          </svg>
          <span>
            A conversation starter, not a verdict. The score blends active time with the apps in
            the foreground; meetings and calls look idle, so talk to the person first.
          </span>
        </p>

        <div className="grid grid-stats">
          <div className="stat">
            <div className="label">Team productivity</div>
            <div className={`value ${summary.score === null ? '' : scoreBand(summary.score)}`}>
              {summary.score === null ? '—' : `${summary.score}%`}
            </div>
            <div className="sub">across {summary.employees} people</div>
          </div>
          <div className="stat">
            <div className="label">Avg active time</div>
            <div className="value">{duration(summary.avgActiveSeconds)}</div>
            <div className="sub">per person, in the range</div>
          </div>
          <div className="stat">
            <div className="label">Avg idle time</div>
            <div className="value">{duration(summary.avgIdleSeconds)}</div>
            <div className="sub">per person, in the range</div>
          </div>
          <div className="stat">
            <div className="label">Needs attention</div>
            <div className="value" style={summary.needsAttention ? { color: 'var(--danger)' } : undefined}>
              {summary.needsAttention}
            </div>
            <div className="sub">score below 50%</div>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>By department</h2>
              <span className="faint">
                <i className="dot productive" />productive <i className="dot neutral" />neutral{' '}
                <i className="dot distracting" />distracting
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>People</th>
                    <th>App mix</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty">No attendance in this range.</div>
                      </td>
                    </tr>
                  ) : (
                    data.departments.map((d) => (
                      <tr key={d.department}>
                        <td>{d.department}</td>
                        <td className="num">{d.employees}</td>
                        <td>
                          <Mix mix={d.mix} />
                        </td>
                        <td className="num">
                          <Score value={d.score} band={d.score >= 75 ? 'great' : d.score >= 60 ? 'good' : d.score >= 50 ? 'average' : 'review'} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Top apps</h2>
              <span className="faint">team-wide</span>
            </div>
            <div className="card-pad">
              {data.apps.length === 0 ? (
                <div className="empty">
                  No app data yet. It appears once the desktop agent reports the foreground app.
                </div>
              ) : (
                data.apps.map((a) => (
                  <div key={a.app} style={{ marginBottom: 10 }}>
                    <div className="inline" style={{ justifyContent: 'space-between' }}>
                      <span>
                        <i className={`dot ${a.category}`} />
                        {a.app}
                      </span>
                      <span className="muted">{duration(a.seconds)}</span>
                    </div>
                    <div className={`bar ${a.category}`} style={{ marginTop: 4 }}>
                      <span style={{ width: `${(a.seconds / topSeconds) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>By employee</h2>
            <span className="faint">lowest scores first</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Worked</th>
                  <th>Idle</th>
                  <th>Top app</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.employees.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">No attendance in this range.</div>
                    </td>
                  </tr>
                ) : (
                  data.employees.map((e) => (
                    <tr key={e.employeeId}>
                      <td>
                        <Link href={`/admin/employees/${e.employeeId}`}>{e.name}</Link>
                      </td>
                      <td className="muted">{e.department || '—'}</td>
                      <td className="num">{duration(e.workedSeconds)}</td>
                      <td className="num muted">{duration(e.idleSeconds)}</td>
                      <td className="muted">{e.topApp || <span className="faint">no app data</span>}</td>
                      <td className="num">
                        <Score value={e.score} band={e.band} />
                      </td>
                      <td>
                        {e.band && <span className={`pill ${BAND_PILL[e.band]}`}>{BAND_LABEL[e.band]}</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <CategoryEditor apps={apps} />
      </div>
    </>
  );
}
