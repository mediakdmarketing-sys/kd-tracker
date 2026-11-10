import Link from 'next/link';
import { dateLabel } from '@/lib/format';

const BIRTHDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const span = (r) => (r.startDate === r.endDate ? dateLabel(r.startDate) : `${dateLabel(r.startDate)} to ${dateLabel(r.endDate)}`);

function Block({ tone, title, count, href, linkLabel, children, empty }) {
  return (
    <section className="dash-block" style={{ '--c': tone }}>
      <header>
        <h3>{title}</h3>
        {count > 0 && <b>{count}</b>}
        {href && count > 0 && <Link href={href}>{linkLabel}</Link>}
      </header>
      {count > 0 ? children : <p className="dash-empty">{empty}</p>}
    </section>
  );
}

/** What needs a person today: decisions waiting, people to check on, and what is coming up. */
export default function Attention({ pending, pendingTotal, flagged, flaggedTotal, birthdays, holiday, today }) {
  return (
    <div className="dash-attention">
      <Block tone="#8b5cf6" title="Leave to decide" count={pendingTotal} href="/admin/leave" linkLabel="Open" empty="No leave requests are waiting for you.">
        <ul>
          {pending.map((r) => (
            <li key={r.id}>
              <strong>{r.employeeName}</strong>
              <span>{r.typeLabel.split(' (')[0]} · {span(r)}</span>
            </li>
          ))}
          {pendingTotal > pending.length && <li className="more">and {pendingTotal - pending.length} more</li>}
        </ul>
      </Block>

      <Block tone="#f43f5e" title="Worth a look" count={flaggedTotal} href="/admin" linkLabel="Live board" empty="Nobody needs checking on right now.">
        <ul>
          {flagged.map((p) => (
            <li key={p.employeeId}>
              <strong>{p.name}</strong>
              <span>{p.reasons.join(' · ')}</span>
            </li>
          ))}
          {flaggedTotal > flagged.length && <li className="more">and {flaggedTotal - flagged.length} more</li>}
        </ul>
      </Block>

      <Block tone="#f59e0b" title="Coming up" count={birthdays.length + (holiday ? 1 : 0)} href="/calendar" linkLabel="Calendar" empty="No birthdays this week and no holiday in the next month.">
        <ul>
          {birthdays.map((b) => (
            <li key={`${b.employeeId}-${b.date}`}>
              <strong>{b.name}</strong>
              <span>{b.date === today ? 'Birthday today' : `Birthday ${BIRTHDAY.format(new Date(`${b.date}T00:00:00Z`))}`}</span>
            </li>
          ))}
          {holiday && (
            <li>
              <strong>{holiday.name}</strong>
              <span>Company holiday · {BIRTHDAY.format(new Date(`${holiday.date}T00:00:00Z`))}</span>
            </li>
          )}
        </ul>
      </Block>
    </div>
  );
}
