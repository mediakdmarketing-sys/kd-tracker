'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, patch, del } from '@/lib/client';
import BulkUpload from '@/components/BulkUpload';
import YearCalendar from '@/components/YearCalendar';

const COLUMNS = [
  { key: 'date', label: 'Date', aliases: ['holiday date', 'day'], required: true },
  { key: 'name', label: 'Name', aliases: ['holiday', 'description', 'occasion'], required: true },
];
const EXAMPLE = 'date,name\n2026-12-25,Christmas Day\n2027-01-01,New Year\n';
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const weekday = (date) => DAY[new Date(`${date}T00:00:00Z`).getUTCDay()];

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function HolidaysManager({ year, rows, birthdays = [], workDays, today }) {
  const router = useRouter();
  const nameInput = useRef(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [repeats, setRepeats] = useState(true);
  const [editing, setEditing] = useState(null); // { id, name, date }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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

  async function add(e) {
    e.preventDefault();
    if (await run(() => post('/api/payroll/holidays', { date, name, repeats }))) {
      setDate('');
      setName('');
    }
  }

  // A click on the calendar: an existing holiday opens for editing, an empty day starts a new one.
  function pick(key, holiday) {
    setError(null);
    if (holiday) {
      setEditing({ id: holiday.id, name: holiday.name, date: holiday.date });
      document.getElementById(`holiday-${holiday.id}`)?.scrollIntoView({ block: 'center' });
    } else {
      setDate(key);
      nameInput.current?.focus();
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Calendar {year}</h2></div>
        <div className="card-pad">
          <p className="muted" style={{ marginTop: 0 }}>
            Click a day to mark it as a holiday, or click a holiday to change it. Holidays you mark come back
            on the same date every year: next year&apos;s calendar fills itself in, and you change what is different.
          </p>
          <YearCalendar year={Number(year)} holidays={rows} birthdays={birthdays} onPick={pick} todayKey={today} />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Birthdays in {year}</h2><span className="muted">{birthdays.length}</span></div>
        <div className="card-pad">
          <p className="muted" style={{ marginTop: 0 }}>
            Active employees only. HR and the person&apos;s leader are told the day before and on the day. Set or
            change a birthday on the employee&apos;s page (Edit details).
          </p>
        </div>
        {birthdays.length === 0 ? (
          <div className="empty">No birthdays have been added yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Employee</th><th>Department</th></tr></thead>
              <tbody>
                {birthdays.map((b) => (
                  <tr key={b.employeeId} style={b.date === today ? { fontWeight: 650 } : undefined}>
                    <td>{SHORT_DATE.format(new Date(`${b.date}T00:00:00Z`))}{b.date === today ? ' · today' : ''}</td>
                    <td><a href={`/admin/employees/${b.employeeId}`}>{b.name}</a></td>
                    <td className="muted">{b.department || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Add a holiday</h2></div>
        <div className="card-pad">
          {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
          <form onSubmit={add}>
            <div className="filters" style={{ marginBottom: 12 }}>
              <div className="field">
                <label htmlFor="h-date">Date</label>
                <input id="h-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="h-name">Name</label>
                <input id="h-name" ref={nameInput} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Independence Day" disabled={busy} />
              </div>
            </div>
            <label className="inline" style={{ gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} disabled={busy} />
              Repeats every year (untick for a one-off)
            </label>
            <div className="inline">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add holiday'}</button>
              <BulkUpload
                title="Upload holidays"
                endpoint="/api/payroll/holidays/bulk"
                columns={COLUMNS}
                example={EXAMPLE}
                templateName="holidays-template.csv"
                hint="One row per holiday: date (YYYY-MM-DD) and name. They repeat every year. A date that is already a holiday is renamed."
                successText={(r) => `Saved: ${r.created} new, ${r.renamed} renamed.`}
              />
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Holidays in {year}</h2><span className="muted">{rows.length}</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Day</th><th>Name</th><th>Repeats</th><th>Paid?</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const dow = new Date(`${h.date}T00:00:00Z`).getUTCDay();
                const paid = dow !== 0 && workDays.includes(dow);
                const isEditing = editing?.id === h.id;
                return (
                  <tr key={h.id} id={`holiday-${h.id}`}>
                    <td>
                      {isEditing ? (
                        <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} disabled={busy} />
                      ) : h.date}
                    </td>
                    <td className="muted">{weekday(isEditing ? editing.date || h.date : h.date)}</td>
                    <td>
                      {isEditing ? (
                        <input value={editing.name} maxLength={120} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={busy} style={{ minWidth: 200 }} />
                      ) : (
                        <>
                          {h.name}
                          {h.autoCopied && (
                            <span className="pill pill-flag" style={{ marginLeft: 8 }} title="Filled in from last year's calendar. Check the date, then Keep it or change it.">
                              Copied from last year
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <label className="inline" style={{ gap: 6 }} title="Comes back on the same date next year">
                        <input
                          type="checkbox"
                          checked={h.repeats}
                          disabled={busy}
                          onChange={(e) => run(() => patch(`/api/payroll/holidays/${h.id}`, { repeats: e.target.checked }))}
                        />
                        <span className="faint">{h.repeats ? 'Yearly' : 'One-off'}</span>
                      </label>
                    </td>
                    <td>{paid ? <span className="pill pill-working">Paid</span> : <span className="pill pill-none" title="Not a working day">Not a working day</span>}</td>
                    <td>
                      <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busy}
                              onClick={async () => (await run(() => patch(`/api/payroll/holidays/${h.id}`, { name: editing.name, date: editing.date }))) && setEditing(null)}
                            >
                              Save
                            </button>
                            <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                          </>
                        ) : (
                          <>
                            {h.autoCopied && (
                              <button type="button" className="btn btn-info" disabled={busy} onClick={() => run(() => patch(`/api/payroll/holidays/${h.id}`, { keep: true }))}>
                                Keep
                              </button>
                            )}
                            <button type="button" className="btn" onClick={() => setEditing({ id: h.id, name: h.name, date: h.date })} disabled={busy}>Edit</button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              disabled={busy}
                              onClick={() =>
                                window.confirm(
                                  `Remove ${h.name} (${h.date})?\n\nIt also will not be copied into later years that have not been created yet.`
                                ) && run(() => del(`/api/payroll/holidays/${h.id}`))
                              }
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="empty">No holidays set for {year} yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
