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
      'Leave it running. Closing it from the tray stops capture, and it does not start by itself when Windows starts, so open WorkBuddy from the Start menu after you turn on your computer.',
      'Only install it on the computer you work on. Do not install it on a shared or personal computer.',
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

export default async function HelpPage() {
  const user = await requireUser();
  const sections = SECTIONS.filter((s) => s.roles.includes(user.role));

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
          </details>
        ))}
      </div>
    </>
  );
}
