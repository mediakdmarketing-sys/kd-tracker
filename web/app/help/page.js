import { requireUser } from '@/lib/api';

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
    title: 'Installing the desktop agent (Windows)',
    roles: ALL,
    body: [
      'Get the WorkBuddy installer (.exe) from HR/IT and run it. It installs for your user only and does not need admin rights.',
      'Windows may show a "Windows protected your PC" warning because the installer is not code-signed yet. Click More info, then Run anyway. This is expected for the company installer.',
      'After install, WorkBuddy starts in the system tray (bottom-right, near the clock; click the ^ arrow if you do not see it). It does not open a normal window.',
      'Sign in on this portal. The agent then asks "Sign this desktop agent in from the web portal?". Click Connect. The tray icon now shows you as signed in.',
      'Leave it running. It starts by itself when you sign in to Windows, so after a restart or power cut it is already running. Quitting it from the tray stops capture until you open WorkBuddy again from the Start menu.',
      'Only install it on the computer you work on. Do not install it on a shared or personal computer.',
    ],
  },
  {
    id: 'agent-mac',
    title: 'Installing the desktop agent (Mac)',
    roles: ALL,
    body: [
      'Pick the right file for your Mac. Apple menu → About This Mac shows the chip: "Apple M1/M2/M3/M4" needs the file with "arm64" in its name, "Intel" needs the file without it.',
      'Open the .dmg, then drag WorkBuddy into the Applications folder.',
      'The first time, do not double-click it. macOS blocks apps that are not from the App Store. In Applications, right-click WorkBuddy → Open → Open. If it still refuses, open System Settings → Privacy & Security, scroll down and click Open Anyway next to WorkBuddy.',
      'WorkBuddy has no Dock icon or window. Look for its icon in the menu bar at the top right, next to the clock. If you are not signed in, a sign-in panel opens by itself.',
      'Allow the permissions it needs in System Settings → Privacy & Security: Screen & System Audio Recording (for screenshots, without it they come out blank) and Microphone (only if you accepted audio monitoring). After you switch a permission on, quit WorkBuddy from the menu bar and open it again.',
      'Optional: switch on Accessibility (same Privacy & Security page) if you want keyboard and mouse counts. Attendance and idle time work without it.',
      'Sign in on this portal and click Connect when the agent asks. It starts by itself when you log in to your Mac. Quitting it from the menu bar stops capture until you open it again from Applications.',
      'macOS says "WorkBuddy is damaged" or will not open? Open Terminal (Spotlight → Terminal) and run these two lines, one at a time: "xattr -cr /Applications/WorkBuddy.app" and then "codesign --force --deep --sign - /Applications/WorkBuddy.app". Then open WorkBuddy again.',
      'Terminal answers "Operation not permitted"? In System Settings → Privacy & Security → App Management switch Terminal on, quit Terminal, open it again and repeat the two lines.',
      '"WorkBuddy is not responding" or nothing appears? Close any stuck copy with "pkill -f WorkBuddy", then open WorkBuddy again from Applications. To see what it prints, run "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy" in Terminal and send the text to HR.',
      'Still stuck? Delete WorkBuddy from Applications, install it again from the .dmg and tell HR which message you saw.',
    ],
  },
  {
    id: 'agent-linux',
    title: 'Installing the desktop agent (Linux)',
    roles: ALL,
    body: [
      'Use an X11 session for full monitoring. On the login screen choose "Ubuntu on Xorg" (or the "X11" option for your desktop). Wayland sessions work for attendance and idle time, but screenshots, keyboard/mouse counts and the active application can be missing.',
      'Debian or Ubuntu: install the .deb with "sudo apt install ./WorkBuddy-<version>.deb". Other distributions: make the AppImage executable ("chmod +x WorkBuddy-<version>.AppImage") and run it.',
      'The agent needs two small system packages for the active application and input counts: on Debian or Ubuntu run "sudo apt install x11-utils libxtst6".',
      'GNOME does not show tray icons by default. Install the "AppIndicator and KStatusNotifierItem Support" extension, then log out and in. Without it the agent still runs; open it from the applications menu to see its window.',
      'The agent starts by itself at login. Quitting it from the tray stops capture until you open WorkBuddy again.',
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
      'Only HR/Admin and, for their own team, a leader can view captured media. Admin access is recorded in an audit log.',
    ],
  },
  {
    id: 'team',
    title: 'For leaders: your team',
    roles: LEADERS,
    body: [
      'My team lists the departments you lead and how many members are working now. Live board shows who is working, on a break or out.',
      'Click a member to see their attendance, screenshots, audio samples, activity counts and project time for a date or date range.',
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
    ],
  },
  {
    id: 'leader-day',
    title: 'For leaders: reading a team member’s day',
    roles: LEADERS,
    body: [
      'Open a member from My team or the Live board. For the day or range you pick you see worked time, breaks, idle time, activity counts, screenshots, audio samples and project time.',
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
      'A team leader can only open people in the departments they lead. Every time anyone opens someone’s screenshots, audio or attendance history it is written to the audit log.',
      'Open captured media only when you have a reason. Do not copy, share or forward it outside the company.',
      'If a screenshot shows something private (a bank page, a personal message), do not act on it and tell HR so it can be reviewed.',
    ],
  },
  {
    id: 'admin-people',
    title: 'For admins: people and structure',
    roles: ADMIN,
    body: [
      'Suggested set-up order: Settings → Departments → Employees → leaders → Projects (only if you track project time).',
      'Employees → add an employee with name, work email, starting password, role, department and employee code.',
      'On an employee page you can edit role and department, reset the password, turn on Blur screenshots, deactivate the account (it signs them out everywhere) and assign or remove them as a department leader.',
      'Projects: create and archive projects. The "Working on" picker only appears for employees once at least one project exists.',
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
    title: 'For admins: settings and audit log',
    roles: ADMIN,
    body: [
      'Settings control screenshot and audio timing, target shift length, break allowance, idle threshold, auto-close time, retention days and whether idle time is deducted from payroll. Changes apply to everyone, and agents pick them up with no reinstall.',
      'The Audit log records who viewed whose screenshots, audio or attendance history and when. It cannot be edited or deleted.',
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

export default async function HelpPage() {
  const user = await requireUser();
  const sections = sectionsFor(user.role);
  const quickStart = QUICK_START[user.role] || QUICK_START.user;
  // Read at request time on the server, so changing the installer link needs no code change.
  const agentDownloadUrl = process.env.AGENT_DOWNLOAD_URL || '';

  return (
    <>
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
          <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 8 }}>{quickStart.title}</div>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.65 }}>
            {quickStart.steps.map((step) => (
              <li key={step} style={{ marginBottom: 4 }}>
                {step}
              </li>
            ))}
          </ol>
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
            <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 15 }}>{s.title}</summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.65 }}>
              {s.body.map((line) => (
                <li key={line} style={{ marginBottom: 6 }}>
                  {line}
                </li>
              ))}
            </ul>
            {s.id === 'agent-install' && agentDownloadUrl && (
              <p style={{ margin: '14px 0 0' }}>
                <a className="btn btn-info" href={agentDownloadUrl} download>
                  Download WorkBuddy for Windows
                </a>
              </p>
            )}
          </details>
        ))}
      </div>
    </>
  );
}
