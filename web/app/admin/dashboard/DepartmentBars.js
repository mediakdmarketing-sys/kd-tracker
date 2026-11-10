import { DEPARTMENT_COLORS } from './states';

const WORKING_DAYS = 26; // the most a month can hold (matches the line chart's axis)

/**
 * One month, one bar per department, each in its own colour: the average days a person attended.
 * Two or more months use the line chart instead, which can compare them.
 */
export default function DepartmentBars({ departments, values }) {
  if (departments.length === 0) {
    return <div className="empty">No departments yet. Create one under Departments.</div>;
  }
  const top = Math.max(WORKING_DAYS, ...values);
  const rows = departments
    .map((name, i) => ({ name, value: values[i] || 0, color: DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length] }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  return (
    <ul className="dash-bars">
      {rows.map((r) => (
        <li key={r.name} style={{ '--c': r.color, '--w': `${Math.max((r.value / top) * 100, r.value > 0 ? 2 : 0)}%` }}>
          <span className="dash-bar-name">{r.name}</span>
          <span className="dash-bar-track" role="img" aria-label={`${r.name}: ${r.value} days on average`}>
            <i />
          </span>
          <span className="dash-bar-value">
            {r.value}
            <small> {r.value === 1 ? 'day' : 'days'}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
