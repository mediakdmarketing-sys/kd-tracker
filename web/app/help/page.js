import { requireUser } from '@/lib/api';
import CopyCommand from '@/components/CopyCommand';
import OpenOnHash from '@/components/OpenOnHash';

export const metadata = { title: 'Help · WorkBuddy' };

const ALL = ['user', 'leader', 'admin'];
const LEADERS = ['leader', 'admin'];
const ADMIN = ['admin'];

// Plain data, so the guide reads top to bottom and a section is added by adding an object.
// `roles` decides who sees it; every account sees the "everyone" sections first.
const SECTIONS = [
  {
    id: 'about',
    title: 'What is WorkBuddy?',
    roles: ALL,
    body: [
      'WorkBuddy is the company attendance and work-tracking app. It records when you start and finish your day, your breaks, your leave and, while you are punched in, how active you were.',
      'It has two parts that work together: this web portal (punch, history, leave, reports) and the desktop agent, a small app on your computer that takes the screenshots and activity counts.',
      'Your day in short: sign in, punch in, work, take breaks when you need them, punch out. Everything else happens in the background.',
    ],
  },
  {
    id: 'start',
    title: 'Getting started',
    roles: ALL,
    body: [
      'Sign in with your work email and password. Forgot it? Ask HR to reset it from your employee page.',
      'The first time, you read and accept the monitoring notice. You cannot punch in until the monitoring box is ticked. The audio box is optional.',
      'Use Sign out at the bottom of the menu on a shared computer.',
    ],
  },
  {
    id: 'agent',
    title: 'The desktop agent',
    roles: ALL,
    body: [
      'Screenshots come from the WorkBuddy desktop agent, not the browser. Install it, start it and leave it running in the system tray.',
      'After you sign in here, the agent asks "Sign this desktop agent in from the web portal?". Click Connect. Click Cancel if you did not just sign in.',
      'Capture only happens when the agent is signed in as you, you are punched in, and you are not on a break.',
      'Pictures taken while you are offline wait in a queue and upload when the connection is back.',
    ],
  },
  {
    id: 'agent-install',
    title: 'Install the desktop agent on Windows',
    badge: 'Windows',
    steps: true,
    roles: ALL,
    body: [
      'Get the WorkBuddy installer (a file ending in .exe) from HR or IT and double-click it. It installs for your user only and does not need an administrator password.',
      { text: 'Windows may show a blue "Windows protected your PC" box. This is expected, the installer is not code-signed yet. Click More info, then Run anyway.', tip: 'It looks alarming, but it only means Microsoft has not seen this installer before.' },
      'When it finishes, WorkBuddy starts in the system tray at the bottom right next to the clock. If you cannot see it, click the ^ arrow. It does not open a normal window.',
      'Sign in on this portal. The agent then asks "Sign this desktop agent in from the web portal?". Click Connect. The tray icon now shows you as signed in.',
      { text: 'Leave it running. It starts by itself when you sign in to Windows, so a restart or power cut does not stop it.', warn: 'Quitting it from the tray stops capture until you open WorkBuddy again from the Start menu. Only install it on the computer you work on, not on a shared or personal one.' },
    ],
  },
  {
    id: 'agent-mac',
    title: 'Install the desktop agent on a Mac',
    badge: 'Mac',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Pick the right file for your Mac. Click the Apple menu, then About This Mac, and read the Chip line.', tip: 'Apple M1, M2, M3 or M4: use the file with "arm64" in its name. Intel: use the file without it.' },
      'Open the .dmg file, then drag WorkBuddy into the Applications folder.',
      { text: 'The first time, do not double-click it. In Applications, right-click WorkBuddy, choose Open, then click Open again.', tip: 'macOS blocks apps that are not from the App Store. If it still refuses, open System Settings, Privacy & Security, scroll down and click Open Anyway next to WorkBuddy.' },
      'WorkBuddy has no Dock icon and no window. Look for its icon in the menu bar at the top right, next to the clock. If you are not signed in, a sign-in panel opens by itself.',
      { text: 'Allow the permissions it asks for in System Settings, Privacy & Security: Screen & System Audio Recording (without it screenshots are blank) and Microphone (only if you accepted audio monitoring).', warn: 'After you switch a permission on, quit WorkBuddy from the menu bar and open it again, otherwise macOS does not apply it.' },
      'Sign in on this portal and click Connect when the agent asks. It starts by itself when you log in to your Mac.',
      { tip: 'Optional: switch on Accessibility on the same Privacy & Security page if you want keyboard and mouse counts. Attendance and idle time work without it.' },
    ],
  },
  {
    id: 'agent-mac-fix',
    title: 'Mac: WorkBuddy will not open',
    badge: 'Mac',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Open Terminal (press Cmd + Space, type Terminal, press Return). Copy each line below, one at a time, paste it and press Return. These two lines remove the "downloaded from the internet" block and re-seal the app.', cmds: ['xattr -cr /Applications/WorkBuddy.app', 'codesign --force --deep --sign - /Applications/WorkBuddy.app'] },
      { text: 'Then open WorkBuddy again from Applications.' },
      { text: 'Terminal said "Operation not permitted"? Terminal needs permission to change apps. Open System Settings, Privacy & Security, App Management and switch Terminal on. Quit Terminal (Cmd + Q), open it again and repeat step 1.' },
      { text: 'Says "not responding", or nothing appears? Close any stuck copy first, then open WorkBuddy again.', cmds: ['pkill -f WorkBuddy'] },
      { text: 'Still nothing? Run it from Terminal so it prints what is wrong, then send that text to HR.', cmds: ['/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy'] },
      { warn: 'Last resort: delete WorkBuddy from Applications, install it again from the .dmg, and tell HR exactly which message you saw.' },
    ],
  },
  {
    id: 'agent-android',
    title: 'Install the WorkBuddy app on an Android phone',
    badge: 'Android',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Download the WorkBuddy app (a file ending in .apk) from the Download button above, or ask HR to send it to you. You need Android 10 or newer.' },
      { text: 'Open the downloaded file. Android asks to allow installs from this source: tap Settings, switch Allow from this source on, go back and tap Install.', tip: 'This is needed because the app is installed directly and not from the Play Store. If Play Protect asks to scan it, choose Scan or Install anyway.' },
      'Open WorkBuddy and sign in with your work email. Allow notifications when asked.',
      'Read the notice about what is recorded and tap I understand and accept. The audio box is optional.',
      { text: 'Tap Punch in. Then tap Start now on the Android box that asks to start capturing your screen. If the app asks for the microphone, allow it only if you accepted audio.', warn: 'Android shows a WorkBuddy notification for as long as capture runs. That is how your phone tells you it is recording, it cannot be hidden.' },
      { text: 'Keep WorkBuddy running during your shift. Tap Start break to pause capture, and Punch out when you finish.', tip: 'If the phone restarts or you force-close the app, open it and tap Start capture again. Android asks for your permission every time.' },
      { text: 'Capture stops by itself when your phone kills the app to save battery. To prevent this, open Settings, Apps, WorkBuddy, Battery and choose Unrestricted.' },
    ],
  },
  {
    id: 'agent-linux',
    title: 'Install the desktop agent on Linux',
    badge: 'Linux',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Use an X11 session. On the login screen click the gear icon and choose "Ubuntu on Xorg" (or the "X11" option for your desktop).', warn: 'Wayland sessions keep attendance and idle time working, but screenshots, keyboard/mouse counts and the active application can be missing.' },
      { text: 'Ubuntu, Debian or Linux Mint: install the .deb file. Open Terminal in the folder where you saved it and run:', cmds: ['sudo apt install ./kd-tracker-agent_*.deb'] },
      { text: 'Fedora, Arch, openSUSE or anything else: use the AppImage file instead. In Terminal, in the folder where you saved it:', cmds: ['chmod +x WorkBuddy-*.AppImage', './WorkBuddy-*.AppImage'], tip: 'If the AppImage will not start, install FUSE first: sudo apt install libfuse2 (Debian/Ubuntu) or sudo dnf install fuse (Fedora).' },
      { text: 'Install two small helper packages so the agent can read the active application and count keyboard/mouse activity (Debian, Ubuntu, Mint):', cmds: ['sudo apt install x11-utils libxtst6'] },
      { text: 'Sign in on this portal and click Connect when the agent asks. It starts by itself when you log in.', warn: 'GNOME (the default Ubuntu and Fedora desktop) hides tray icons. Install the "AppIndicator and KStatusNotifierItem Support" extension, then log out and in. Without it the agent still runs, open WorkBuddy from the applications menu to see its panel.' },
    ],
  },
  {
    id: 'shift',
    title: 'Punching in, breaks and punching out',
    roles: ALL,
    body: [
      'My shift → Punch in starts your day and starts capture. Start break pauses capture and the work clock. End break resumes. Punch out ends the shift.',
      'Your break allowance is shown on the panel (60 minutes a day by default). Going over it flags the day for HR review.',
      'Forgot to punch out? The shift is closed automatically after a set time (16 hours by default) and flagged so HR can confirm the real end.',
      'Punching in here or in the agent is the same thing; either one updates the other within about 20 seconds.',
      'My history lists your past shifts. Use the date filter to change the range.',
    ],
  },
  {
    id: 'leave',
    title: 'Requesting leave',
    roles: ALL,
    body: [
      'Open Leave and fill in the form: type (Sick, Bereavement, Personal, Emergency or Company Vacation), full or half day, dates and an optional reason.',
      'Sick, Bereavement and Emergency leave need proof: a photo or PDF up to 5 MB. A half day is always a single date.',
      'The request shows as Pending until your leader or HR approves or rejects it. You can cancel it while it is still pending.',
      'When you send a request, your team leader and HR are notified. When one of them decides, you get a notification (the red number next to Notifications in the menu) and the Leave page shows who decided.',
    ],
  },
  {
    id: 'privacy',
    title: 'What is captured, and what is not',
    roles: ALL,
    body: [
      'Screenshots are taken at random times, every 5–10 minutes by default, only while you are punched in and not on a break.',
      'Activity counts are the number of keystrokes and mouse actions and the name of the active app. What you type is never captured.',
      'Audio samples are optional and off unless you accept them. You can turn them off at any time.',
      'Screenshots and audio are deleted automatically after 31 days by default. Only the fact that a capture happened is kept.',
      'Only HR/Admin and, for their own team, a leader can view captured media. Admin access is recorded.',
    ],
  },
  {
    id: 'team',
    title: 'For leaders: your team',
    roles: LEADERS,
    body: [
      'My team lists the departments you lead and how many members are working now. Live board shows who is working, on a break or out.',
      'Click a member to see their attendance, screenshots, audio samples, and activity counts for a date or date range.',
      'Leave requests → Pending, Approved, Rejected or All. Open a request, check the dates, reason and proof, then Approve or Reject.',
      'Captured media is sensitive. Open it only when you need to.',
      'If My team says you do not lead a department yet, ask HR to assign you.',
    ],
  },
  {
    id: 'leader-leave',
    title: 'For leaders: approving leave',
    roles: LEADERS,
    body: [
      'Open Leave requests and filter by Pending. Each request shows the type, dates, full or half day, the reason and any proof file.',
      'Sick, Bereavement and Emergency leave need proof. If none is attached, say so in your decision: leave taken without proof is treated as No Pay Leave.',
      'Approve or Reject. The employee sees the new status straight away.',
      'You are notified of new requests from your department (the red number next to Notifications). If HR decides one first, you are told and the request shows "by <name> (HR / Admin)". When you decide, HR and any other leader of the department are told the same way. A request is decided once, by whoever gets to it first.',
    ],
  },
  {
    id: 'leader-day',
    title: 'For leaders: reading a team member’s day',
    roles: LEADERS,
    body: [
      'Open a member from My team or the Live board. For the day or range you pick you see worked time, breaks, idle time, activity counts, screenshots and audio samples.',
      'Worked time is the total for the whole day, so an employee who punched out and back in (for example after a power cut) is counted once, not twice.',
      'Over the shift target is shown as overtime. It is information for you, not an approval.',
    ],
  },
  {
    id: 'leader-flags',
    title: 'For leaders: flags and what they mean',
    roles: LEADERS,
    body: [
      'Over the break allowance: the day total of breaks went past the allowance.',
      'Auto-closed: the employee never punched out, so the system ended the shift. The real end time needs confirming with them or HR.',
      'Needs review: something about the shift was unusual, for example a punch that arrived late from an offline computer. The reason is written next to the flag.',
      'Appears idle: no keyboard or mouse activity for longer than the idle threshold while punched in. Check before assuming, the person may be in a meeting or reading.',
    ],
  },
  {
    id: 'leader-privacy',
    title: 'For leaders: privacy rules',
    roles: LEADERS,
    body: [
      'A team leader can only open people in the departments they lead. Every time anyone opens someone’s screenshots, audio or attendance history it is recorded.',
      'Open captured media only when you have a reason. Do not copy, share or forward it outside the company.',
      'If a screenshot shows something private (a bank page, a personal message), do not act on it and tell HR so it can be reviewed.',
    ],
  },
  {
    id: 'admin-people',
    title: 'For admins: people and structure',
    roles: ADMIN,
    body: [
      'Suggested set-up order: Settings → Departments → Employees → leaders.',
      'Employees → add an employee with name, work email, starting password, role, department and employee code.',
      'On an employee page you can edit role and department, reset the password, turn on Blur screenshots, deactivate the account (it signs them out everywhere) and assign or remove them as a department leader.',
    ],
  },
  {
    id: 'admin-reports',
    title: 'For admins: reports, payroll and leave',
    roles: ADMIN,
    body: [
      'Live board shows everyone working, on a break or out right now.',
      'Productivity scores people for a period: 60+ is Good, 50–59 Average, below 50 Review. Treat it as a conversation starter, not a verdict.',
      'Reports: pick a date range and optionally a department, then Export CSV.',
      'Payroll: choose the month, Generate to summarise closed shifts, then Export CSV. Generating again for the same month is safe, it updates rather than duplicates. Review flagged and auto-closed shifts first.',
      'Leave requests shows every request in the company, with proof files, for approval or rejection.',
    ],
  },
  {
    id: 'admin-rollout',
    title: 'For admins: rolling out the desktop agent',
    roles: ADMIN,
    body: [
      'Employees need the WorkBuddy agent on the computer they work on. Once the installer link is configured for the portal, a Download button appears on every employee’s Help and My shift pages.',
      'Roll out in two steps: try it with two or three employees for a day, check that their screenshots appear on their member page, then give the link to everyone.',
      'Each employee signs in on the portal, then clicks Connect when the agent asks. After that the agent keeps itself signed in.',
      'Someone punched in but no captures? Check that the agent is running, that they are signed in on it, and that they accepted the monitoring notice. See "Something is not working".',
      'Agents with auto-update turned on install new versions by themselves, only while the employee is punched out.',
    ],
  },
  {
    id: 'admin-payroll-check',
    title: 'For admins: monthly payroll checklist',
    roles: ADMIN,
    body: [
      '1. After the last working day, open Live board and make sure nobody is still punched in.',
      '2. Go through the flagged and auto-closed shifts for the month (they are marked on each employee’s attendance). Confirm the real end time with the employee or their leader.',
      '3. Approve or reject any pending Leave requests for the month, so leave is counted correctly.',
      '4. Open Payroll, choose the month and click Generate. Generating again for the same month updates the figures, it never duplicates them.',
      '5. Export CSV and keep the file with your payroll records.',
    ],
  },
  {
    id: 'admin-offboarding',
    title: 'For admins: when someone leaves',
    roles: ADMIN,
    body: [
      'Open the employee’s page and choose Deactivate. They are signed out everywhere at once, including the desktop agent, and can no longer punch in.',
      'Their history, payroll rows and audit entries stay. Nothing is deleted, and captured media is removed on the normal retention schedule.',
      'If they led a department, assign a new leader first so leave requests are not left with nobody to approve them.',
      'Ask them to uninstall WorkBuddy from any personal computer it was installed on.',
    ],
  },
  {
    id: 'admin-settings',
    title: 'For admins: settings',
    roles: ADMIN,
    body: [
      'Settings control screenshot and audio timing, target shift length, break allowance, idle threshold, auto-close time, retention days and whether idle time is deducted from payroll. Changes apply to everyone, and agents pick them up with no reinstall.',
    ],
  },
  {
    id: 'glossary',
    title: 'Words used in the app',
    roles: ALL,
    body: [
      'All times in WorkBuddy are New York time (Eastern Time), whatever country your computer is in. A "day" starts and ends at midnight New York time.',
      'Punch in / Punch out: start and end of your working day.',
      'Break: time you pause the work clock. You have a daily allowance; going over it flags the day for HR review.',
      'Flagged: a day HR should look at, for example an over-long break or a missing punch out.',
      'Auto-closed: a shift the system ended for you because you never punched out. HR confirms the real end time.',
      'Idle: no keyboard or mouse activity for a set time (10 minutes by default).',
      'No Pay Leave: sick, bereavement or emergency leave taken without proof.',
      'Pending / Approved / Rejected / Cancelled: the status of a leave request.',
    ],
  },
  {
    id: 'faq',
    title: 'Common questions',
    roles: ALL,
    body: [
      'Can my leader see my screen live? No. Screenshots are taken at random times and reviewed later; there is no live viewing.',
      'Is my password or what I type recorded? No. Only the count of keystrokes and mouse actions is kept, never the content.',
      'I forgot to punch in. Tell your leader or HR; they can correct the day. Do not punch in late and leave it.',
      'My internet dropped. The agent keeps screenshots and punches in a queue on your computer and uploads them when you are back online.',
      'Can I use WorkBuddy on my phone? You can open the portal to view history and request leave, but screenshots only come from the desktop agent.',
    ],
  },
  {
    id: 'trouble',
    title: 'Something is not working',
    roles: ALL,
    body: [
      'Sent back to the sign-in page: your session ended. Sign in again.',
      'First page load is slow after a quiet spell: the server is waking up. Wait up to a minute.',
      'Punched in but no screenshots: check the agent is running and signed in, you are not on a break, and the monitoring notice is accepted. Still stuck? Tell HR.',
      'The page reloaded by itself: a reply was interrupted and the page recovered. Nothing is lost.',
    ],
  },
];

const ROLE_LABEL = { user: 'Employee', leader: 'Team leader', admin: 'HR / Admin' };

// A short checklist at the top, so each role sees what to do first.
const QUICK_START = {
  user: {
    title: 'Your first day in four steps',
    steps: [
      'Install the WorkBuddy desktop agent and leave it running in the system tray.',
      'Sign in on this portal, read the monitoring notice and accept it. Click Connect when the agent asks.',
      'Open My shift and click Punch in. Take breaks with Start break and End break.',
      'When you finish, click Punch out. Signing out is not needed.',
    ],
  },
  leader: {
    title: 'Your first day as a team leader',
    steps: [
      'Open My team to see the departments you lead and who is working now.',
      'Use Live board during the day. Click a member to read their day.',
      'Check Leave requests for anything Pending and approve or reject it.',
      'Your own shift works like everyone else’s: install the agent, punch in, punch out.',
    ],
  },
  admin: {
    title: 'Getting the company set up',
    steps: [
      'Settings: confirm shift length, break allowance, capture timing and retention.',
      'Departments, then Employees, then assign a leader to each department.',
      'Give employees the agent installer link and check one pilot account’s screenshots.',
      'Each month: review flags, then Payroll → Generate → Export CSV.',
    ],
  },
};

// Sections each role should read first, in this order. Everything else follows in page order.
const ROLE_FIRST = {
  leader: ['team', 'leader-leave', 'leader-day', 'leader-flags', 'leader-privacy'],
  admin: ['admin-people', 'admin-rollout', 'admin-reports', 'admin-payroll-check', 'admin-settings', 'admin-offboarding'],
};

function sectionsFor(role) {
  const visible = SECTIONS.filter((s) => s.roles.includes(role));
  const first = ROLE_FIRST[role] || [];
  const rank = (s) => {
    const i = first.indexOf(s.id);
    return i === -1 ? first.length : i;
  };
  // Array.prototype.sort is stable, so sections outside the list keep their written order.
  return [...visible].sort((a, b) => rank(a) - rank(b));
}

// --- Rendering -----------------------------------------------------------------------------
// An item in a section's `body` is a plain string, or an object with any of:
//   text  a sentence          cmds  commands to paste into a terminal (each gets a Copy button)
//   tip   a helpful aside      warn  something that must not be missed

const NUMBER_STYLE = {
  flex: 'none',
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  display: 'grid',
  placeItems: 'center',
  marginTop: 1,
};

const CALLOUT = {
  tip: { label: 'Tip', background: 'var(--accent-soft)', color: 'var(--accent-text)' },
  warn: { label: 'Important', background: 'var(--warn-soft)', color: '#8a5200' },
};

function Callout({ kind, children }) {
  const c = CALLOUT[kind];
  return (
    <div
      style={{
        background: c.background,
        color: c.color,
        borderRadius: 10,
        padding: '9px 12px',
        margin: '8px 0',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ marginRight: 6 }}>{c.label}:</strong>
      {children}
    </div>
  );
}

function ItemBody({ item }) {
  const it = typeof item === 'string' ? { text: item } : item;
  return (
    <>
      {it.text && <div style={{ lineHeight: 1.6 }}>{it.text}</div>}
      {it.cmds && it.cmds.map((cmd) => <CopyCommand key={cmd} command={cmd} />)}
      {it.tip && <Callout kind="tip">{it.tip}</Callout>}
      {it.warn && <Callout kind="warn">{it.warn}</Callout>}
    </>
  );
}

function Steps({ items }) {
  return (
    <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 14 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={NUMBER_STYLE}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ItemBody item={item} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }) {
  return (
    <ul style={{ margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.65 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          <ItemBody item={item} />
        </li>
      ))}
    </ul>
  );
}

function Badge({ children }) {
  return (
    <span
      style={{
        marginLeft: 10,
        padding: '2px 9px',
        borderRadius: 999,
        background: 'var(--accent-soft)',
        color: 'var(--accent-text)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

const INSTALL_GUIDES = [
  { id: 'agent-install', label: 'Windows' },
  { id: 'agent-mac', label: 'Mac' },
  { id: 'agent-linux', label: 'Linux' },
  { id: 'agent-android', label: 'Android' },
];

export default async function HelpPage() {
  const user = await requireUser();
  const sections = sectionsFor(user.role);
  const quickStart = QUICK_START[user.role] || QUICK_START.user;
  // Read at request time on the server, so changing the installer link needs no code change.
  const agentDownloadUrl = process.env.AGENT_DOWNLOAD_URL || '';
  // The APK is served from this portal itself (web/public/downloads), so installing needs no
  // account anywhere else. Set ANDROID_DOWNLOAD_URL to host it elsewhere instead.
  const androidDownloadUrl = process.env.ANDROID_DOWNLOAD_URL || '/downloads/WorkBuddy.apk';

  return (
    <>
      <OpenOnHash />
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p>
            How to use WorkBuddy. You are signed in as: <strong>{ROLE_LABEL[user.role] || 'User'}</strong>.
            Questions this page does not answer? Ask HR.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <div style={{ fontWeight: 650, fontSize: 15 }}>{quickStart.title}</div>
          <Steps items={quickStart.steps} />
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 650, fontSize: 15 }}>Install the desktop agent</div>
          <p className="faint" style={{ margin: '4px 0 12px', fontSize: 13 }}>
            Screenshots and activity come from a small app on your computer or phone. Pick your
            system for the step-by-step guide.
          </p>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
            {INSTALL_GUIDES.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="btn">
                {g.label} guide
              </a>
            ))}
            {agentDownloadUrl && (
              <a className="btn btn-info" href={agentDownloadUrl} download>
                Download for Windows
              </a>
            )}
            {androidDownloadUrl && (
              <a className="btn btn-info" href={androidDownloadUrl} download>
                Download for Android
              </a>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <div className="faint" style={{ marginBottom: 8, fontSize: 13 }}>
            Jump to
          </div>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="btn">
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {sections.map((s, i) => (
          <details key={s.id} id={s.id} className="card card-pad" open={i === 0}>
            <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 15 }}>
              {s.title}
              {s.badge && <Badge>{s.badge}</Badge>}
            </summary>
            {s.steps ? <Steps items={s.body} /> : <Bullets items={s.body} />}
          </details>
        ))}
      </div>
    </>
  );
}
