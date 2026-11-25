const LABEL = { online: 'Connected', quiet: 'Not responding', none: 'Not connected' };
const CLASS = { online: 'pill-working', quiet: 'pill-break', none: 'pill-none' };
const CLIENT = { desktop: 'Desktop agent', chromeos: 'ChromeOS', android: 'Android app' };

function ago(iso) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/**
 * Is this person's agent (the desktop app or the phone app) talking to the server?
 *   Connected       asked the server within the last 3 minutes
 *   Not responding  signed in, but silent for longer: closed, asleep or offline
 *   Not connected   no agent signed in
 * While someone is on a shift, "not connected" and "not responding" mean nothing is being captured.
 *
 * @param {{ agent?: {state: string, lastSeenAt: string|null, device: string|null, client: string|null}|null, onShift?: boolean }} props
 */
export default function AgentBadge({ agent, onShift = false }) {
  if (!agent) return <span className="faint">—</span>;
  const seen = ago(agent.lastSeenAt);
  const versionNote = agent.version
    ? ` Version ${agent.version}${agent.update === 'outdated' ? ' (an older version: the update is not installed)' : ''}.`
    : '';
  const title = versionNote && agent.state !== 'none' ? `${baseTitle(agent, seen)}${versionNote}` : baseTitle(agent, seen);
  return (
    <span className={`pill ${onShift && agent.state !== 'online' ? 'pill-flag' : CLASS[agent.state]}`} title={title}>
      {LABEL[agent.state]}
      {agent.state === 'quiet' && seen ? ` · ${seen}` : ''}
    </span>
  );
}

function baseTitle(agent, seen) {
  return (
    agent.state === 'none'
      ? 'No desktop or phone app is signed in for this person.'
      : agent.state === 'online'
      ? `${CLIENT[agent.client] || 'The agent'}${agent.device ? ` on ${agent.device}` : ''} is talking to the server.`
      : `${CLIENT[agent.client] || 'The agent'}${agent.device ? ` on ${agent.device}` : ''} is signed in but silent${seen ? `: last heard from ${seen}` : ''}. It may be closed, asleep or offline.`
  );
}
