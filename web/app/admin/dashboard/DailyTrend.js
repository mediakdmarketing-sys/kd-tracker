'use client';

import { useMemo, useState } from 'react';

// Bars, one per day, for the chosen measure. Hover or focus a bar for the exact figures.
const MEASURES = [
  { key: 'workedSeconds', label: 'Hours worked', color: '#2563eb', format: (v) => hm(v), tick: (v) => `${Math.round(v / 3600)}h` },
  { key: 'people', label: 'People in', color: '#0fb88a', format: (v) => `${v} ${v === 1 ? 'person' : 'people'}`, tick: (v) => String(Math.round(v)) },
  { key: 'breakSeconds', label: 'Break time', color: '#f59e0b', format: (v) => hm(v), tick: (v) => `${Math.round(v / 3600)}h` },
  { key: 'flagged', label: 'Needs a look', color: '#e11d48', format: (v) => `${v} ${v === 1 ? 'day' : 'days'} flagged`, tick: (v) => String(Math.round(v)) },
];

function hm(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const W = 920;
const H = 300;
const M = { top: 16, right: 16, bottom: 40, left: 44 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** A tidy top for the axis: 1, 2, 5 or 10 times a power of ten, at or above the largest value. */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dateLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function DailyTrend({ days, today }) {
  const [measureKey, setMeasureKey] = useState('workedSeconds');
  const [hover, setHover] = useState(null);
  const measure = MEASURES.find((m) => m.key === measureKey);

  const { max, ticks } = useMemo(() => {
    // Round in the unit people read (hours, not seconds), so the axis says 100h, 200h, not 139h.
    const unit = measureKey === 'workedSeconds' || measureKey === 'breakSeconds' ? 3600 : 1;
    const top = niceMax(Math.max(0, ...days.map((d) => d[measureKey])) / unit) * unit;
    // Hours axes step in whole hours; counts in whole people.
    return { max: top, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => top * f) };
  }, [days, measureKey]);

  if (!days.length) return <div className="empty">No data yet.</div>;

  const slot = PLOT_W / days.length;
  const barW = Math.min(36, slot * 0.62);
  const x = (i) => M.left + slot * i + (slot - barW) / 2;
  const y = (v) => M.top + PLOT_H - (v / max) * PLOT_H;
  const everyOther = days.length > 14 ? 2 : 1;
  const shown = hover === null ? null : days[hover];

  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <div className="dash-seg" role="tablist" aria-label="Chart measure">
        {MEASURES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === measureKey}
            className={m.key === measureKey ? 'is-on' : ''}
            onClick={() => setMeasureKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${measure.label} for the last ${days.length} days`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {measure.tick(v)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const v = d[measureKey];
          const isToday = d.date === today;
          const off = d.people === 0; // nobody worked: a weekend or a holiday
          const height = Math.max(v > 0 ? 3 : 0, PLOT_H - (y(v) - M.top));
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${dateLabel(d.date)}: ${measure.format(v)}`}>
              {/* A full-height hit area, so a short bar is as easy to hover as a tall one. */}
              <rect x={M.left + slot * i} y={M.top} width={slot} height={PLOT_H} fill={hover === i ? 'var(--accent-soft)' : 'transparent'} opacity={hover === i ? 0.6 : 1} />
              <rect
                x={x(i)}
                y={M.top + PLOT_H - height}
                width={barW}
                height={height}
                rx="5"
                fill={measure.color}
                opacity={isToday ? 1 : 0.78}
              />
              {isToday && <rect x={x(i)} y={M.top + PLOT_H - height} width={barW} height={height} rx="5" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeDasharray="3 3" />}
              {i % everyOther === 0 && (
                <>
                  <text x={x(i) + barW / 2} y={H - 20} textAnchor="middle" fontSize="11" fontWeight={isToday ? 700 : 400} fill={off ? 'var(--text-faint)' : 'var(--muted)'}>
                    {dayLabel(d.date)}
                  </text>
                  <text x={x(i) + barW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
                    {dateLabel(d.date)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {shown && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: `${Math.min(Math.max(((M.left + slot * (hover + 0.5)) / W) * 100, 12), 88)}%`,
            top: 40,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            background: 'var(--surface, #fff)',
            border: `2px solid ${measure.color}`,
            borderRadius: 8,
            padding: '7px 11px',
            fontSize: 12.5,
            boxShadow: '0 4px 16px rgba(0,0,0,.14)',
            whiteSpace: 'nowrap',
          }}
        >
          <strong>{dayLabel(shown.date)}, {dateLabel(shown.date)}</strong>
          <div className="muted">{shown.people === 0 ? 'Nobody worked' : `${shown.people} in Â· ${hm(shown.workedSeconds)} worked`}</div>
          {shown.people > 0 && (
            <div className="muted">
              {hm(shown.breakSeconds)} break{shown.flagged ? ` Â· ${shown.flagged} flagged` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
