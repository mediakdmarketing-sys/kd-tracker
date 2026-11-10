import { duration } from '@/lib/format';
import { STATES, BY_KEY, FLAG_COLOR, initials } from './states';

const ORDER = Object.fromEntries(STATES.map((s, i) => [s.key, i]));
const R = 54;
const CIRC = 2 * Math.PI * R;

/** The ring: one arc per state, sized by how many people are in it. */
function Ring({ summary }) {
  const total = summary.total || 0;
  const counts = {
    working: summary.working,
    on_break: summary.onBreak,
    punched_out: summary.punchedOut,
    not_started: summary.notStarted,
    on_leave: summary.onLeave,
  };
  let offset = 0;
  const onShift = (summary.working || 0) + (summary.onBreak || 0);
  return (
    <figure className="dash-ring">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${onShift} of ${total} people on shift`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
        {total > 0 &&
          STATES.map((s) => {
            const n = counts[s.key] || 0;
            if (!n) return null;
            const len = (n / total) * CIRC;
            const arc = (
              <circle
                key={s.key}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                strokeDasharray={`${Math.max(len - 3, 0.5)} ${CIRC}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += len;
            return arc;
          })}
      </svg>
      <figcaption>
        <strong>{onShift}</strong>
        <span>of {total} on shift</span>
      </figcaption>
    </figure>
  );
}

/**
 * Everyone, as a chip in the colour of what they are doing, grouped by department. Hover (or
 * read the label) for the name, the state and the hours so far.
 */
export default function TeamToday({ employees, summary }) {
  const groups = new Map();
  for (const e of employees) {
    const key = e.department || 'No department';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const departments = [...groups.entries()]
    .map(([name, people]) => ({
      name,
      people: people.sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let n = 0;
  return (
    <div className="dash-team">
      <Ring summary={summary} />
      <div className="dash-depts">
        {departments.length === 0 && <p className="muted">No active employees yet. Add people under Employees.</p>}
        {departments.map((d) => {
          const working = d.people.filter((p) => p.state === 'working' || p.state === 'on_break').length;
          return (
            <section key={d.name} className="dash-dept">
              <header>
                <h3>{d.name}</h3>
                <span>{working} of {d.people.length} on shift</span>
              </header>
              <ul>
                {d.people.map((p) => {
                  const s = BY_KEY[p.state] || BY_KEY.not_started;
                  const flagged = p.overBreak || p.needsReview;
                  const worked = p.workedSeconds > 0 ? ` · ${duration(p.workedSeconds)} worked` : '';
                  const label = `${p.name}: ${s.label}${worked}${flagged ? ' · needs a look' : ''}`;
                  return (
                    <li
                      key={p.employeeId}
                      className={`dash-chip${flagged ? ' is-flagged' : ''}`}
                      style={{ '--c': s.color, '--flag': FLAG_COLOR, '--i': Math.min(n++, 60) }}
                      data-tip={label}
                      aria-label={label}
                    >
                      {initials(p.name)}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
