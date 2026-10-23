'use client';

import { useMemo, useRef, useState } from 'react';

const COLORS = ['#6d5ef0', '#0fb88a', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6', '#f97316', '#14b8a6', '#64748b', '#a855f7'];

const W = 920;
const H = 400;
const M = { top: 20, right: 28, bottom: 56, left: 46 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const Y_MAX = 26; // working days in a month; grows only if the data somehow exceeds it
const Y_STEP = 2;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** Smooth line through the points that never overshoots (monotone cubic), so a dip to 0 stays at 0. */
function smoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const tan = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tan.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  tan.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      tan[i] = (3 * a * slope[i]) / h;
      tan[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (tan[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (tan[i + 1] * dx[i]) / 3;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/**
 * One line per month across the departments (x), average days attended per person (y).
 * Hovering a line names its month; hovering a point also gives the department and value.
 */
export default function AttendanceChart({ departments, months }) {
  const wrapRef = useRef(null);
  const [active, setActive] = useState(null); // month index of the hovered line
  const [tip, setTip] = useState(null); // { x, y, month, department, value, color }

  const yMax = useMemo(() => {
    const top = Math.max(0, ...months.flatMap((m) => m.values));
    return Math.max(Y_MAX, Math.ceil(top / Y_STEP) * Y_STEP);
  }, [months]);

  if (departments.length === 0) {
    return <div className="empty">No departments yet. Create one under Departments.</div>;
  }

  const xAt = (i) => M.left + (departments.length === 1 ? PLOT_W / 2 : (i / (departments.length - 1)) * PLOT_W);
  const yAt = (v) => M.top + PLOT_H - (v / yMax) * PLOT_H;
  const ticks = [];
  for (let v = 0; v <= yMax; v += Y_STEP) ticks.push(v);

  const series = months.map((m, si) => ({
    ...m,
    color: COLORS[si % COLORS.length],
    pts: m.values.map((v, i) => ({ x: xAt(i), y: yAt(v), v })),
  }));

  function showTip(event, si, i) {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setActive(si);
    setTip({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      month: monthLabel(series[si].month),
      department: departments[i],
      value: series[si].values[i],
      color: series[si].color,
    });
  }

  // Which department column is the pointer closest to (for hovering the line between points).
  function nearestIndex(event) {
    const svg = event.currentTarget.ownerSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < departments.length; i++) {
      if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i;
    }
    return best;
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative' }}
      onMouseLeave={() => {
        setActive(null);
        setTip(null);
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Attendance days per department, one line per month">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={yAt(v)} y2={yAt(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.left - 10} y={yAt(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}

        {departments.map((d, i) => (
          <text key={d} x={xAt(i)} y={H - M.bottom + 22} textAnchor="middle" fontSize="12" fill="var(--muted)">
            {d.length > 14 ? `${d.slice(0, 13)}…` : d}
          </text>
        ))}

        <text
          x={12}
          y={M.top + PLOT_H / 2}
          fontSize="11"
          fill="var(--muted)"
          textAnchor="middle"
          transform={`rotate(-90 12 ${M.top + PLOT_H / 2})`}
        >
          Days attended (avg per person)
        </text>

        {series.map((s, si) => {
          const dim = active !== null && active !== si;
          return (
            <g key={s.month} opacity={dim ? 0.18 : 1} style={{ transition: 'opacity .12s' }}>
              <path d={smoothPath(s.pts)} fill="none" stroke={s.color} strokeWidth={active === si ? 3.5 : 2.5} strokeLinecap="round" />
              {s.pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={active === si ? 5 : 3.5} fill={s.color} stroke="var(--surface, #fff)" strokeWidth="1.5" />
              ))}
              {/* Wide invisible stroke so a thin line is easy to hover. */}
              <path
                d={smoothPath(s.pts)}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                style={{ cursor: 'pointer' }}
                onMouseMove={(e) => showTip(e, si, nearestIndex(e))}
              />
              {s.pts.map((p, i) => (
                <circle
                  key={`h${i}`}
                  cx={p.x}
                  cy={p.y}
                  r="10"
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseMove={(e) => showTip(e, si, i)}
                />
              ))}
            </g>
          );
        })}
      </svg>

      <div className="inline" style={{ flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 6 }}>
        {series.map((s, si) => (
          <button
            key={s.month}
            type="button"
            onMouseEnter={() => setActive(si)}
            onMouseLeave={() => setActive(null)}
            style={{
              background: 'none',
              border: 0,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--text)',
              opacity: active !== null && active !== si ? 0.4 : 1,
            }}
          >
            <i style={{ width: 22, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {monthLabel(s.month)}
          </button>
        ))}
      </div>

      {tip && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth || 600) - 190),
            top: Math.max(tip.y - 64, 4),
            pointerEvents: 'none',
            background: 'var(--surface, #fff)',
            border: `2px solid ${tip.color}`,
            borderRadius: 8,
            padding: '7px 11px',
            fontSize: 12.5,
            boxShadow: '0 4px 16px rgba(0,0,0,.14)',
            whiteSpace: 'nowrap',
          }}
        >
          <strong>{tip.month}</strong>
          <div className="muted">
            {tip.department}: {tip.value} {tip.value === 1 ? 'day' : 'days'}
          </div>
        </div>
      )}
    </div>
  );
}
