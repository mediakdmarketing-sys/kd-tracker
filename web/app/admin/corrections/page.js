import Link from 'next/link';
import { api, requireUser } from '@/lib/api';
import CorrectionsQueue from './CorrectionsQueue';

export const metadata = { title: 'Time corrections · WorkInvigilator' };

const TABS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];

export default async function AdminCorrectionsPage({ searchParams }) {
  const params = await searchParams;
  const user = await requireUser({ adminOnly: true });
  const status = TABS.some(([key]) => key === params.status) ? params.status : 'pending';
  const requests = await api(`/api/corrections/review?status=${status}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time corrections</h1>
          <p>
            Employees ask to fix a punch-in or punch-out they forgot. Approving changes their hours (and their pay, if the
            month is still open). A finalized payroll month cannot be changed.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              className="btn"
              href={`/admin/corrections?status=${key}`}
              style={key === status ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
        <CorrectionsQueue requests={requests} timezone={user.timezone} currentUserId={user.id} />
      </div>
    </>
  );
}
