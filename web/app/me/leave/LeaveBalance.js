const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * This year's leave: for each type, days taken and, when HR has set an allowance, what is left.
 * A type with no allowance and nothing taken is not shown.
 */
export default function LeaveBalance({ data }) {
  const shown = data.balances.filter((b) => b.allowance !== null || b.used > 0 || b.pending > 0);
  if (!shown.length) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Your leave in {data.year}</h2>
        <span className="faint">Working days. Waiting requests are counted as taken until they are decided.</span>
      </div>
      <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {shown.map((b) => {
          const taken = b.used + b.pending;
          const over = b.left !== null && b.left < 0;
          const pct = b.allowance ? Math.min(100, (taken / b.allowance) * 100) : 0;
          return (
            <div key={b.type} className="lb-item">
              <div className="lb-label">{b.label}</div>
              {b.allowance === null ? (
                <div className="lb-main">
                  {fmt(taken)} <small>{taken === 1 ? 'day' : 'days'} taken</small>
                </div>
              ) : (
                <>
                  <div className="lb-main" style={over ? { color: 'var(--danger)' } : undefined}>
                    {over ? `${fmt(-b.left)} over` : fmt(b.left)} <small>{over ? 'the allowance' : 'left'}</small>
                  </div>
                  <div className="lb-track" role="img" aria-label={`${fmt(taken)} of ${fmt(b.allowance)} days used`}>
                    <i style={{ width: `${pct}%`, background: over ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }} />
                  </div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {fmt(b.used)} taken{b.pending ? ` · ${fmt(b.pending)} waiting` : ''} · {fmt(b.allowance)} a year
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
