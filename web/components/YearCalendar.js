'use client';

// A year at a glance: twelve small months. Sundays are shaded (always a day off), holidays are
// coloured with their name on hover. Optionally clickable, so HR can pick a day to mark or edit.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HEAD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Month({ year, month, byDate, bdays, onPick, todayKey }) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const blanks = first.getUTCDay(); // Sunday-first, so the Sunday column is the left one
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div className="cal-month">
      <div className="cal-title">{MONTHS[month]}</div>
      <div className="cal-grid">
        {HEAD.map((h, i) => (
          <div key={`h${i}`} className={`cal-head${i === 0 ? ' cal-sun' : ''}`}>{h}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const holiday = byDate[key];
          const sunday = new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
          const classes = ['cal-day'];
          if (sunday) classes.push('cal-sun');
          if (holiday) classes.push('cal-holiday');
          if (holiday?.autoCopied) classes.push('cal-copied');
          if (key === todayKey) classes.push('cal-today');
          const birthdays = bdays[key];
          if (birthdays) classes.push('cal-bday');
          const parts = [];
          if (holiday) parts.push(holiday.name + (holiday.autoCopied ? ' (copied from last year: check the date)' : ''));
          else if (sunday) parts.push('Sunday: day off');
          if (birthdays) parts.push(`Birthday: ${birthdays.map((b) => b.name).join(', ')}`);
          const title = parts.length ? parts.join(' · ') : undefined;
          const props = { className: classes.join(' '), title };
          return onPick ? (
            <button type="button" key={key} {...props} onClick={() => onPick(key, holiday)}>{day}</button>
          ) : (
            <div key={key} {...props}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {number} props.year
 * @param {Array<{date: string, name: string, autoCopied?: boolean}>} props.holidays
 * @param {Array<{date: string, name: string}>} [props.birthdays]  marked with a dot, name on hover
 * @param {(date: string, holiday?: object) => void} [props.onPick]
 * @param {string} [props.todayKey]   "YYYY-MM-DD" to ring
 */
export default function YearCalendar({ year, holidays, birthdays = [], onPick, todayKey }) {
  const byDate = Object.fromEntries(holidays.map((h) => [h.date, h]));
  const bdays = {};
  for (const b of birthdays) (bdays[b.date] ||= []).push(b);
  return (
    <div>
      <div className="cal-legend">
        <span><i className="cal-key cal-sun" /> Sunday (always a day off)</span>
        <span><i className="cal-key cal-holiday" /> Holiday</span>
        <span><i className="cal-key cal-holiday cal-copied" /> Copied from last year: check the date</span>
        {birthdays.length > 0 && <span><i className="cal-key cal-bday" /> Birthday</span>}
      </div>
      <div className="cal-year">
        {MONTHS.map((_, m) => (
          <Month key={m} year={year} month={m} byDate={byDate} bdays={bdays} onPick={onPick} todayKey={todayKey} />
        ))}
      </div>
    </div>
  );
}
