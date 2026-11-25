import Link from 'next/link';

const STATE = {
  current: { label: 'Up to date', cls: 'pill-ok', help: 'On the newest version.' },
  outdated: { label: 'Not updated', cls: 'pill-flag', help: 'Still on an older version: the update has not been installed.' },
  unknown: { label: 'Unknown', cls: 'pill-idle', help: 'The agent has not said which version it is (an older build, or it has not connected since).' },
  not_installed: { label: 'No agent', cls: 'pill-idle', help: 'No desktop agent is signed in for this person.' },
  other: { label: 'Phone app', cls: 'pill-idle', help: 'The phone app is updated from its own installer, not here.' },
};

/**
 * Who has installed the newest desktop agent and who has not. Shared by HR (everyone) and a team
 * leader (their own people). `data` is what /api/admin|leader/agent-updates returns.
 */
export default function AgentUpdatesTable({ data, timezone, scope = 'admin' }) {
  const { release, summary, rows } = data;
  const when = (iso) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
      : '—';

  return (
    <>
      <div className="grid grid-stats">
        <div className="stat">
          <div className="label">Newest version</div>
          <div className="value">{release ? release.version : '—'}</div>
          <div className="sub">{release ? `published ${when(release.publishedAt)}` : 'nothing published yet'}</div>
        </div>
        <div className="stat">
          <div className="label">Up to date</div>
          <div className="value" style={{ color: 'var(--ok, #12805c)' }}>{summary.current}</div>
          <div className="sub">of {summary.people} people</div>
        </div>
        <div className="stat">
          <div className="label">Not updated</div>
          <div className="value" style={{ color: summary.outdated ? '#e11d48' : undefined }}>{summary.outdated}</div>
          <div className="sub">on an older version</div>
        </div>
        <div className="stat">
          <div className="label">Unknown</div>
          <div className="value">{summary.unknown}</div>
          <div className="sub">version not reported</div>
        </div>
        <div className="stat">
          <div className="label">No agent</div>
          <div className="value">{summary.notInstalled}</div>
          <div className="sub">nothing signed in</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Agent versions</h2>
            <span className="faint" style={{ fontSize: 12 }}>The people to chase come first.</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">No one to show.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Update</th>
                  <th>Version</th>
                  <th>Agent</th>
                  <th>Last heard from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = STATE[r.update] || STATE.unknown;
                  return (
                    <tr key={r.employeeId}>
                      <td>
                        <Link href={scope === 'admin' ? `/admin/employees/${r.employeeId}` : `/leader/members/${r.employeeId}`}>{r.name}</Link>
                      </td>
                      <td className="muted">{r.department || '—'}</td>
                      <td><span className={`pill ${s.cls}`} title={s.help}>{s.label}</span></td>
                      <td className="num">{r.version || <span className="faint">—</span>}</td>
                      <td className="muted">{r.agentState === 'none' ? '—' : r.agentState === 'online' ? 'Connected' : 'Silent'}{r.device ? ` · ${r.device}` : ''}</td>
                      <td className="num">{when(r.lastSeenAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
