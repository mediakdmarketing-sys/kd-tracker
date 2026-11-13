'use client';

import Link from 'next/link';
import { useState } from 'react';

const BAND = {
  attention: { color: '#e11d48', label: 'Needs attention' },
  watch: { color: '#f59e0b', label: 'Keep an eye' },
  good: { color: '#10b981', label: 'On track' },
};

const PARTS = [
  ['productivity', 'Productivity'],
  ['punctuality', 'Punch-in time'],
  ['finishing', 'Punch-out time'],
  ['breaks', 'Breaks'],
  ['mic', 'Microphone'],
];

const colorOf = (score) => (score < 50 ? BAND.attention.color : score < 70 ? BAND.watch.color : BAND.good.color);

/**
 * Department by department, who is weakest. One bar per person (lowest first), and opening a
 * person shows the five parts behind the score, so the number can be checked rather than trusted.
 */
export default function PerformanceWatch({ data }) {
  const [dept, setDept] = useState('all');
  const [open, setOpen] = useState(null);

  if (!data.departments.length) {
    return <div className="empty">Nobody has worked in the last {data.days} days, so there is nothing to compare yet.</div>;
  }

  const shownPeople =
    dept === 'all' ? data.worst : data.departments.find((d) => d.department === dept)?.employees || [];
  const workdayMissing = data.workday.start == null || data.workday.end == null;

  return (
    <div>
      {workdayMissing && (
        <div className="notice notice-info" style={{ marginBottom: 14 }}>
          {data.workday.start == null && data.workday.end == null
            ? 'Punch-in and punch-out times are not counted yet.'
            : data.workday.start == null
            ? 'Punch-in time is not counted yet.'
            : 'Punch-out time is not counted yet.'}{' '}
          Set the workday start and end in <Link href="/admin/settings">Settings</Link> to include them.
        </div>
      )}

      <div className="pw-depts" role="tablist" aria-label="Department">
        <button type="button" role="tab" aria-selected={dept === 'all'} className={dept === 'all' ? 'is-on' : ''} onClick={() => { setDept('all'); setOpen(null); }}>
          Lowest 5 overall
        </button>
        {data.departments.map((d) => (
          <button
            key={d.department}
            type="button"
            role="tab"
            aria-selected={dept === d.department}
            className={dept === d.department ? 'is-on' : ''}
            onClick={() => { setDept(d.department); setOpen(null); }}
          >
            <i style={{ background: colorOf(d.score) }} />
            {d.department} <b>{d.score}</b>
          </button>
        ))}
      </div>

      <ul className="pw-list">
        {shownPeople.map((e) => {
          const isOpen = open === e.employeeId;
          return (
            <li key={e.employeeId}>
              <button type="button" className="pw-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.employeeId)}>
                <span className="pw-name">
                  {e.name}
                  {dept === 'all' && <small>{e.department}</small>}
                </span>
                <span className="pw-track" role="img" aria-label={`${e.name}: ${e.score} out of 100`}>
                  <i style={{ width: `${Math.max(e.score, 2)}%`, background: colorOf(e.score) }} />
                </span>
                <span className="pw-score" style={{ color: colorOf(e.score) }}>{e.score}</span>
              </button>

              {isOpen && (
                <div className="pw-detail">
                  <div className="faint" style={{ marginBottom: 8 }}>
                    {BAND[e.band].label}. Based on {e.days} worked {e.days === 1 ? 'day' : 'days'}
                    {e.weakest ? `. Weakest: ${PARTS.find(([k]) => k === e.weakest)?.[1]}.` : '.'}
                  </div>
                  <ul>
                    {PARTS.map(([key, label]) => {
                      const part = e.parts[key];
                      return (
                        <li key={key}>
                          <span>{label}</span>
                          <span className="pw-track pw-track-sm">
                            {part.score !== null && <i style={{ width: `${Math.max(part.score, 2)}%`, background: colorOf(part.score) }} />}
                          </span>
                          <span className="pw-part-score">{part.score === null ? '—' : part.score}</span>
                          <span className="faint pw-part-detail">{part.detail}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <Link href={`/admin/employees/${e.employeeId}`} className="pw-link">Open {e.name.split(' ')[0]}’s page →</Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>
        Score out of 100 from productivity (35%), punch-in time (20%), punch-out time (15%), breaks (15%) and microphone (15%),
        over the last {data.days} days. A part that could not be measured is left out, not counted against anyone. This is a
        reason to have a conversation, not a verdict: meetings, calls and approved leave can all look like poor numbers.
      </p>
    </div>
  );
}
