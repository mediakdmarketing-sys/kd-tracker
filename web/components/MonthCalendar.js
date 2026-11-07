'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post, patch, del } from '@/lib/client';

// The company calendar, one month at a time: Sundays, holidays, leave and birthdays, as much of
// each as the server decided this person may see. HR can also mark and edit holidays here.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEAVE_TYPE = { sick: 'Sick', bereavement: 'Bereavement', personal: 'Personal', emergency: 'Emergency', vacation: 'Vacation' };
const DAY_PART = { full: '', half_am: ' (morning)', half_pm: ' (afternoon)' };
const LONG_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const MAX_CHIPS = 3;

const utc = (date) => new Date(`${date}T00:00:00Z`);
const isoOf = (d) => d.toISOString().slice(0, 10);

/** Every date from `from` to `to`, both included. */
function eachDate(from, to) {
  const out = [];
  for (let d = utc(from); isoOf(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoOf(d));
  return out;
}

export default function MonthCalendar({ month, today, role, holidays, leave, birthdays, start, end }) {
  const router = useRouter();
  const admin = role === 'admin';
  const [selected, setSelected] = useState(today >= start && today <= end ? today : null);
  const [show, setShow] = useState({ holidays: true, leave: true, birthdays: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', repeats: true });
  const [editing, setEditing] = useState(null); // { id, name }

  const byDate = useMemo(() => {
    const map = {};
    const slot = (date) => (map[date] ||= { holiday: null, leave: [], birthdays: [] });
    for (const h of holidays) slot(h.date).holiday = h;
    for (const l of leave) {
      for (const date of eachDate(l.start < start ? start : l.start, l.end > end ? end : l.end)) slot(date).leave.push(l);
    }
    for (const b of birthdays) slot(b.date).birthdays.push(b);
    return map;
  }, [holidays, leave, birthdays, start, end]);

  const first = utc(start);
  const days = Number(end.slice(8));
  const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];

  const canSeeBirthdays = role !== 'user';
  const leaveLabel = role === 'admin' ? 'Leave' : role === 'leader' ? 'Team leave' : 'My leave';

  function chipsFor(date) {
    const info = byDate[date];
    if (!info) return [];
    const chips = [];
    if (show.holidays && info.holiday) chips.push({ key: 'h', kind: 'holiday', text: info.holiday.name });
    if (show.leave) {
      for (const l of info.leave) {
        chips.push({ key: `l${l.id}`, kind: l.status === 'pending' ? 'leave-pending' : 'leave', text: role === 'user' ? `${LEAVE_TYPE[l.type] || l.type}${DAY_PART[l.dayPart] || ''}` : l.name });
      }
    }
    if (show.birthdays) {
      for (const b of info.birthdays) chips.push({ key: `b${b.employeeId}`, kind: 'birthday', text: b.name });
    }
    return chips;
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const info = selected ? byDate[selected] : null;
  const sunday = selected ? utc(selected).getUTCDay() === 0 : false;

  return (
    <>
      <div className="card card-pad">
        <div className="mcal-filters">
          <label className="inline" style={{ gap: 6 }}>
            <input type="checkbox" checked={show.holidays} onChange={(e) => setShow({ ...show, holidays: e.target.checked })} />
            <span className="mcal-chip mcal-holiday">Holidays</span>
          </label>
          <label className="inline" style={{ gap: 6 }}>
            <input type="checkbox" checked={show.leave} onChange={(e) => setShow({ ...show, leave: e.target.checked })} />
            <span className="mcal-chip mcal-leave">{leaveLabel}</span>
          </label>
          {canSeeBirthdays && (
            <label className="inline" style={{ gap: 6 }}>
              <input type="checkbox" checked={show.birthdays} onChange={(e) => setShow({ ...show, birthdays: e.target.checked })} />
              <span className="mcal-chip mcal-birthday">Birthdays</span>
            </label>
          )}
          <span className="faint" style={{ fontSize: 12 }}>
            <i className="cal-key cal-sun" /> Sunday is always a day off. Dashed leave is waiting for approval.
          </span>
        </div>

        <div className="mcal-grid" role="grid" aria-label={`Calendar ${month}`}>
          {DAYS.map((d, i) => (
            <div key={d} className={`mcal-head${i === 0 ? ' mcal-sun' : ''}`}>{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`b${i}`} className="mcal-blank" />;
            const chips = chipsFor(date);
            const isSunday = utc(date).getUTCDay() === 0;
            const cls = ['mcal-day'];
            if (isSunday) cls.push('mcal-sun');
            if (byDate[date]?.holiday && show.holidays) cls.push('mcal-off');
            if (date === today) cls.push('mcal-today');
            if (date === selected) cls.push('mcal-selected');
            return (
              <button
                type="button"
                key={date}
                className={cls.join(' ')}
                onClick={() => {
                  setSelected(date === selected ? null : date);
                  setEditing(null);
                  setError(null);
                }}
                aria-pressed={date === selected}
                aria-label={`${LONG_DATE.format(utc(date))}${chips.length ? `, ${chips.length} item${chips.length === 1 ? '' : 's'}` : ''}`}
              >
                <span className="mcal-num">{Number(date.slice(8))}</span>
                {chips.slice(0, MAX_CHIPS).map((c) => (
                  <span key={c.key} className={`mcal-chip mcal-${c.kind}`} title={c.text}>{c.text}</span>
                ))}
                {chips.length > MAX_CHIPS && <span className="mcal-more">+{chips.length - MAX_CHIPS} more</span>}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="card">
          <div className="card-head">
            <h2>{LONG_DATE.format(utc(selected))}</h2>
            {sunday && <span className="pill pill-none">Sunday: day off</span>}
          </div>
          <div className="card-pad">
            {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}

            {info?.holiday ? (
              <div className="mcal-row">
                <span className="mcal-chip mcal-holiday">Holiday</span>
                {editing ? (
                  <>
                    <input value={editing.name} maxLength={120} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={busy} />
                    <button type="button" className="btn btn-primary" disabled={busy || !editing.name.trim()}
                      onClick={async () => (await run(() => patch(`/api/payroll/holidays/${editing.id}`, { name: editing.name }))) && setEditing(null)}>Save</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <strong>{info.holiday.name}</strong>
                    {admin && info.holiday.autoCopied && (
                      <span className="pill pill-flag" title="Filled in from last year. Check the date, then Keep it or change it.">Copied from last year</span>
                    )}
                    {admin && (
                      <span className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {info.holiday.autoCopied && (
                          <button type="button" className="btn btn-info" disabled={busy}
                            onClick={() => run(() => patch(`/api/payroll/holidays/${info.holiday.id}`, { keep: true }))}>Keep</button>
                        )}
                        <button type="button" className="btn" disabled={busy} onClick={() => setEditing({ id: info.holiday.id, name: info.holiday.name })}>Rename</button>
                        <button type="button" className="btn btn-danger" disabled={busy}
                          onClick={() =>
                            window.confirm(`Remove ${info.holiday.name} (${selected})?\n\nIt also will not be copied into later years that have not been created yet.`) &&
                            run(() => del(`/api/payroll/holidays/${info.holiday.id}`))
                          }>Remove</button>
                      </span>
                    )}
                  </>
                )}
              </div>
            ) : (
              admin && !sunday && (
                <form
                  className="mcal-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run(() => post('/api/payroll/holidays', { date: selected, name: form.name.trim(), repeats: form.repeats }))) {
                      setForm({ name: '', repeats: true });
                    }
                  }}
                >
                  <span className="muted">Mark as a company holiday:</span>
                  <input required maxLength={120} placeholder="Name, e.g. Independence Day" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} />
                  <label className="inline" style={{ gap: 6 }}>
                    <input type="checkbox" checked={form.repeats} onChange={(e) => setForm({ ...form, repeats: e.target.checked })} disabled={busy} />
                    Every year
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim()}>Add holiday</button>
                </form>
              )
            )}

            {info?.leave.map((l) => (
              <div className="mcal-row" key={l.id}>
                <span className={`mcal-chip ${l.status === 'pending' ? 'mcal-leave-pending' : 'mcal-leave'}`}>Leave</span>
                <strong>{role === 'user' ? 'You' : l.name}</strong>
                <span>{LEAVE_TYPE[l.type] || l.type}{DAY_PART[l.dayPart] || ''}</span>
                <span className="faint">{l.start === l.end ? l.start : `${l.start} to ${l.end}`}</span>
                {l.status === 'pending' && <span className="pill pill-flag">Waiting for approval</span>}
              </div>
            ))}

            {info?.birthdays.map((b) => (
              <div className="mcal-row" key={b.employeeId}>
                <span className="mcal-chip mcal-birthday">Birthday</span>
                {admin ? <Link href={`/admin/employees/${b.employeeId}`}><strong>{b.name}</strong></Link> : <strong>{b.name}</strong>}
                <span className="faint">{b.department || ''}</span>
              </div>
            ))}

            {!info?.holiday && !info?.leave.length && !info?.birthdays.length && (sunday ? (
              <p className="muted" style={{ margin: 0 }}>Sunday is always a day off. Nobody can punch in.</p>
            ) : (!admin && <p className="muted" style={{ margin: 0 }}>Nothing on this day.</p>))}
          </div>
        </div>
      )}
    </>
  );
}
