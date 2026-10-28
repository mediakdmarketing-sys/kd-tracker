import { duration, formatBytes } from '@/lib/format';

/** A small bar chart in plain SVG: no chart library, readable in light and dark. */
function Bars({ title, values, labels, format, color = 'var(--accent)' }) {
  const W = 300;
  const H = 90;
  const max = Math.max(...values, 1);
  const bar = W / values.length;
  const total = values.reduce((n, v) => n + v, 0);

  return (
    <div className="card card-pad" style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 650, fontSize: 13 }}>{title}</div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>{format(total)} in {values.length} days</div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, (v / max) * H);
          return (
            <rect key={labels[i]} x={i * bar + 1} y={H - h} width={Math.max(1, bar - 2)} height={h} rx="1.5" fill={color}>
              <title>{`${labels[i]}: ${format(v)}`}</title>
            </rect>
          );
        })}
        <line x1="0" y1={H + 0.5} x2={W} y2={H + 0.5} stroke="var(--border)" />
        <text x="0" y={H + 11} fontSize="9" fill="var(--text-muted)">{labels[0].slice(5)}</text>
        <text x={W} y={H + 11} fontSize="9" textAnchor="end" fill="var(--text-muted)">{labels[labels.length - 1].slice(5)}</text>
      </svg>
    </div>
  );
}

export default function UsageChart({ usage }) {
  const labels = usage.series.map((d) => d.date);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      <Bars title="Hours worked" values={usage.series.map((d) => d.workedSeconds)} labels={labels} format={(v) => duration(v)} />
      <Bars title="People punched in" values={usage.series.map((d) => d.people)} labels={labels} format={(v) => String(v)} color="#0a7d4b" />
      <Bars title="Capture data added" values={usage.series.map((d) => d.storageBytes)} labels={labels} format={(v) => formatBytes(v)} color="#b7791f" />
    </div>
  );
}
