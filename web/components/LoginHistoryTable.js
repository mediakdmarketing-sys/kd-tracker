const RESULT = {
  success: { label: 'Signed in', cls: 'pill-working' },
  bad_password: { label: 'Wrong password', cls: 'pill-flag' },
  bad_code: { label: 'Wrong code', cls: 'pill-flag' },
  locked: { label: 'Held', cls: 'pill-flag' },
  deactivated: { label: 'Account off', cls: 'pill-flag' },
};

/** A list of sign-in attempts: when, what happened, from which device and address. Shared by the person's own Security page and HR's view. */
export default function LoginHistoryTable({ history, timezone }) {
  if (!history.length) return <div className="empty">No sign-ins recorded yet.</div>;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What happened</th>
            <th>Device</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => {
            const r = RESULT[h.result] || { label: h.result, cls: 'pill-none' };
            return (
              <tr key={h.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmt.format(new Date(h.at))}</td>
                <td>
                  <span className={`pill ${r.cls}`}>{r.label}</span>
                  {h.newDevice && <span className="pill pill-idle" style={{ marginLeft: 6 }}>New device</span>}
                  {h.twoStep && h.result === 'success' && <span className="faint" style={{ marginLeft: 6, fontSize: 11 }}>two-step</span>}
                </td>
                <td>{h.device}</td>
                <td className="faint num">{h.ip || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
