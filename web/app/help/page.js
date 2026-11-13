import { requireUser } from '@/lib/api';
import CopyCommand from '@/components/CopyCommand';
import OpenOnHash from '@/components/OpenOnHash';
import HelpSearch from '@/components/HelpSearch';
import { latestBuilds } from '@/lib/latestBuilds';

export const metadata = { title: 'Help · WorkInvigilator' };

const ALL = ['user', 'leader', 'admin'];
const LEADERS = ['leader', 'admin'];
const ADMIN = ['admin'];

// Plain data, so the guide reads top to bottom and a section is added by adding an object.
// `roles` decides who sees it; every account sees the "everyone" sections first.
const SECTIONS = [
  {
    id: 'about',
    title: 'What is WorkInvigilator?',
    roles: ALL,
    body: [
      'WorkInvigilator is the company attendance and work-tracking app. It records when you start and finish your day, your breaks, your leave and, while you are punched in, how active you were.',
      'It has two parts that work together: this web portal (punch, history, leave, reports) and the desktop agent, a small app on your computer that takes the screenshots and activity counts.',
      'Your day in short: sign in, punch in, work, take breaks when you need them, punch out. Everything else happens in the background.',
    ],
  },
  {
    id: 'start',
    title: 'Getting started',
    roles: ALL,
    body: [
      'New here? HR sends you a message with the web link, your username (your work email) and a temporary password. The first time you sign in you are asked to choose your own password. You can change it again any time with Change password at the bottom of the menu.',
      'Password rules: at least 8 characters (12 for HR / Admin accounts, which can see everyone’s data). It must not be a common password such as Password123 or Welcome2026, and must not contain your name or email. A few words you will remember work well, for example "blue-tea-morning-bus". Someone made an HR / Admin is asked to choose a new password at their next sign-in so it meets the longer rule.',
      'Sign in with your work email and password. Forgot it? Ask HR to send you a new invitation from your employee page.',
      'The first time, you read and accept the monitoring notice. You cannot punch in until the monitoring box is ticked. The audio box is optional.',
      'Use Sign out at the bottom of the menu on a shared computer.',
    ],
  },
  {
    id: 'agent',
    title: 'The desktop agent',
    roles: ALL,
    body: [
      'Screenshots come from the WorkInvigilator desktop agent, not the browser. Install it, start it and leave it running in the system tray.',
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
      'Get the WorkInvigilator installer (a file ending in .exe) from HR or IT and double-click it. It installs for your user only and does not need an administrator password.',
      { text: 'Windows may show a blue "Windows protected your PC" box. This is expected, the installer is not code-signed yet. Click More info, then Run anyway.', tip: 'It looks alarming, but it only means Microsoft has not seen this installer before.' },
      'When it finishes, WorkInvigilator starts in the system tray at the bottom right next to the clock. If you cannot see it, click the ^ arrow. It does not open a normal window.',
      'Sign in on this portal. The agent then asks "Sign this desktop agent in from the web portal?". Click Connect. The tray icon now shows you as signed in.',
      { text: 'Leave it running. It starts by itself when you sign in to Windows, so a restart or power cut does not stop it.', warn: 'Quitting it from the tray stops capture until you open WorkInvigilator again from the Start menu. Only install it on the computer you work on, not on a shared or personal one.' },
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
      'Open the .dmg file, then drag WorkInvigilator into the Applications folder.',
      { text: 'The first time, do not double-click it. In Applications, right-click WorkInvigilator, choose Open, then click Open again.', tip: 'macOS blocks apps that are not from the App Store. If it still refuses, open System Settings, Privacy & Security, scroll down and click Open Anyway next to WorkInvigilator.' },
      'WorkInvigilator has no Dock icon and no window. Look for its icon in the menu bar at the top right, next to the clock. If you are not signed in, a sign-in panel opens by itself.',
      { text: 'Allow the permissions it asks for in System Settings, Privacy & Security: Screen & System Audio Recording (without it screenshots are blank) and Microphone (only if you accepted audio monitoring).', warn: 'After you switch a permission on, quit WorkInvigilator from the menu bar and open it again, otherwise macOS does not apply it.' },
      'Sign in on this portal and click Connect when the agent asks. It starts by itself when you log in to your Mac.',
      { tip: 'Optional: switch on Accessibility on the same Privacy & Security page if you want keyboard and mouse counts. Attendance and idle time work without it.' },
    ],
  },
  {
    id: 'agent-mac-fix',
    title: 'Mac: WorkInvigilator will not open',
    badge: 'Mac',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Open Terminal (press Cmd + Space, type Terminal, press Return). Copy each line below, one at a time, paste it and press Return. These two lines remove the "downloaded from the internet" block and re-seal the app.', cmds: ['xattr -cr /Applications/WorkInvigilator.app', 'codesign --force --deep --sign - /Applications/WorkInvigilator.app'] },
      { text: 'Then open WorkInvigilator again from Applications.' },
      { text: 'Terminal said "Operation not permitted"? Terminal needs permission to change apps. Open System Settings, Privacy & Security, App Management and switch Terminal on. Quit Terminal (Cmd + Q), open it again and repeat step 1.' },
      { text: 'Says "not responding", or nothing appears? Close any stuck copy first, then open WorkInvigilator again.', cmds: ['pkill -f WorkInvigilator'] },
      { text: 'Still nothing? Run it from Terminal so it prints what is wrong, then send that text to HR.', cmds: ['/Applications/WorkInvigilator.app/Contents/MacOS/WorkInvigilator'] },
      { warn: 'Last resort: delete WorkInvigilator from Applications, install it again from the .dmg, and tell HR exactly which message you saw.' },
    ],
  },
  {
    id: 'agent-android',
    title: 'Install the WorkInvigilator app on an Android phone',
    badge: 'Android',
    steps: true,
    roles: ALL,
    body: [
      { text: 'Download the WorkInvigilator app (a file ending in .apk) from the Download button above, or ask HR to send it to you. You need Android 10 or newer.' },
      { text: 'Open the downloaded file. Android asks to allow installs from this source: tap Settings, switch Allow from this source on, go back and tap Install.', tip: 'This is needed because the app is installed directly and not from the Play Store. If Play Protect asks to scan it, choose Scan or Install anyway.' },
      'Open WorkInvigilator and sign in with your work email. Allow notifications when asked.',
      'Read the notice about what is recorded and tap I understand and accept. The audio box is optional.',
      { text: 'Tap Punch in. Then tap Start now on the Android box that asks to start capturing your screen. If the app asks for the microphone, allow it only if you accepted audio.', warn: 'Android shows a WorkInvigilator notification for as long as capture runs. That is how your phone tells you it is recording, it cannot be hidden.' },
      { text: 'Keep WorkInvigilator running during your shift. Tap Start break to pause capture, and Punch out when you finish.', tip: 'If the phone restarts or you force-close the app, open it and tap Start capture again. Android asks for your permission every time.' },
      { text: 'Capture stops by itself when your phone kills the app to save battery. To prevent this, open Settings, Apps, WorkInvigilator, Battery and choose Unrestricted.' },
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
      { text: 'Fedora, Arch, openSUSE or anything else: use the AppImage file instead. In Terminal, in the folder where you saved it:', cmds: ['chmod +x WorkInvigilator-*.AppImage', './WorkInvigilator-*.AppImage'], tip: 'If the AppImage will not start, install FUSE first: sudo apt install libfuse2 (Debian/Ubuntu) or sudo dnf install fuse (Fedora).' },
      { text: 'Install two small helper packages so the agent can read the active application and count keyboard/mouse activity (Debian, Ubuntu, Mint):', cmds: ['sudo apt install x11-utils libxtst6'] },
      { text: 'Sign in on this portal and click Connect when the agent asks. It starts by itself when you log in.', warn: 'GNOME (the default Ubuntu and Fedora desktop) hides tray icons. Install the "AppIndicator and KStatusNotifierItem Support" extension, then log out and in. Without it the agent still runs, open WorkInvigilator from the applications menu to see its panel.' },
    ],
  },
  {
    id: 'shift',
    title: 'Punching in, breaks and punching out',
    roles: ALL,
    body: [
      'My shift → Punch in starts your day and starts capture. Start break pauses capture and the work clock. End break resumes. Punch out ends the shift.',
      'Signing out while you are punched in puts your shift on a break: the work clock and capture pause, and your leader and HR see you as On break. When you sign in again, click End break to carry on. A break that started this way says so on your My shift panel. It counts against your break allowance like any break, so punch out (not just sign out) when you finish for the day.',
      'Zoom camera rule (Windows desktop agent only, and only when HR has turned it on in Settings): if you are in a Zoom meeting and your camera stays off for the set number of minutes, a break starts by itself. You get a notification when the camera first goes off, and another when the break starts. The break ends by itself when you turn the camera on or the meeting ends, or you can click End break (it will not start again in that meeting). A break you started yourself is never touched. The agent only checks whether a Zoom meeting is on and whether Zoom is using the camera. It never sees the video, the meeting or the audio.',
      'Your break allowance is shown on the panel (60 minutes a day by default). Going over it flags the day for HR review.',
      'Forgot to punch out? The shift is closed automatically after a set time (16 hours by default) and flagged so HR can confirm the real end.',
      'Punching in here or in the agent is the same thing; either one updates the other within about 20 seconds.',
      'My history lists your past shifts. Use the date filter to change the range.',
    ],
  },
  {
    id: 'calendar',
    title: 'The calendar',
    roles: ALL,
    body: [
      'Calendar in the menu shows one month at a time, with Previous, Next and Today to move around. Year view shows the whole year at a glance.',
      'Every day shows what is on it: Sundays (shaded, always a day off), company holidays (red), leave (blue; dashed means it is still waiting for approval) and, for leaders and HR, birthdays (gold). Click a day to see the details underneath.',
      'You see your own leave. A team leader also sees the leave and birthdays of the people they lead. HR sees everyone. Use the tick boxes at the top to hide what you do not need.',
      'HR can also mark holidays here: click a day, type a name and Add holiday. Click a holiday to Rename or Remove it, or Keep it if it was copied from last year. Holiday list & upload is for adding many at once from a spreadsheet.',
    ],
  },
  {
    id: 'leave',
    title: 'Requesting leave',
    roles: ALL,
    body: [
      'Open Leave and fill in the form: type (Sick, Bereavement, Personal, Emergency or Company Vacation), full or half day, dates and an optional reason.',
      'Sick, Bereavement and Emergency leave need proof: a photo or PDF up to 5 MB. Attached the wrong file? Click Remove file next to its name before you submit, then choose the right one. Proof is only so HR can check the reason: it does not make a leave paid. With or without proof, only Company Vacation is paid (unless HR has changed that), and the rest is No Pay Leave. A half day is always a single date.',
      'You cannot approve or reject your own leave, whatever your role. An HR / Admin’s request is decided by another admin (the other admins are notified when it is made), and a team leader’s request is decided by HR. So there needs to be at least one other admin.',
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
      'While audio is on, the agent also looks about once a minute (for roughly two seconds) whether your microphone is switched on. It only measures if there is a signal: nothing is recorded or sent except "muted" or "working again". If your microphone is muted or cannot start, HR and your team leader are told, with your name, and the Mic log shows from when to when.',
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
      'Birthdays: you get a notification the day before and on the day for people in the departments you lead, so you can wish them. HR sets the birthdays.',
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
      'Sick, Bereavement and Emergency leave need proof so you can check the reason. If none is attached, say so in your decision. Proof does not change pay: leave is paid or not by its type (by default only Company Vacation is paid; the rest is No Pay Leave), with or without proof.',
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
      'Employees → Add employee with name, work email, role and department. Leave the password empty and the system makes a temporary one. After you create the account you get a ready invitation (web link, username, temporary password) to copy, send on WhatsApp or open in your email app. The password is shown only then.',
      'Lost or never received it? Open the employee and click Send invitation: it makes a new temporary password and a new message, and signs them out everywhere. They choose their own password at the next sign-in.',
      'On an employee page you can edit role and department, reset the password, turn on Blur screenshots, deactivate the account (it signs them out everywhere) and assign or remove them as a department leader.',
    ],
  },
  {
    id: 'admin-timesheet',
    title: 'For admins: the live timesheet and everyone’s screenshots',
    roles: ADMIN,
    body: [
      'Timesheet in the menu shows each person’s day live: whether they are working, on a break, finished, not started or on leave, when they punched in and out, and their worked time, break time and idle time. A person who is working shows their hours counting up; the page refreshes itself every minute.',
      'It starts on today. Use From and To for another day or a range (up to 31 days), Employee is a searchable dropdown: click it to see everyone, type to narrow the list (for example "ravi"), then pick the person (the × clears it), and Department to see one team (the Employee list then shows only that team). Apply sets the filters. For a single day, people who have not punched in are listed too, so you can see who is missing.',
      'Mic muted shows how many times that person’s microphone was found muted (or could not be used) that day, and for how long in all. "Muted now" means the latest check still found it muted. Click it to open the Mic log for that day, which has the exact times. It comes from the audio samples, so it only counts people who accepted audio monitoring and have the desktop agent running; a dash or 0 means no muted mic was found, not that nothing was checked.',
      'Under the table are everyone’s screenshots, grouped by person, for up to 7 days at a time. Each screenshot stays closed until you click it, and opening one is recorded in the audit log, the same as on a person’s own page. People who have Blur screenshots switched on stay blurred until you click. The number in the Screenshots column jumps to that person’s pictures.',
      'Only HR / Admin can open this page. A team leader sees their own team on My team and the Live board.',
    ],
  },
  {
    id: 'admin-dashboard-charts',
    title: 'For admins: the dashboard charts',
    roles: ADMIN,
    body: [
      'Last 14 days: one bar per day. Pick Hours worked, People in, Break time or Needs a look, and hover a bar for that day’s figures. Days nobody worked (weekends, holidays) show no bar.',
      'Who needs attention: pick a department to see its people, lowest first, or “Lowest 5 overall”. Click a name to see the five parts behind the score: productivity (35%), punch-in time (20%), punch-out time (15%), breaks (15%) and microphone (15%), over the last 14 days.',
      'Punch-in and punch-out time need the workday start and end, set in Settings under Shift & breaks (New York time). Until they are set, those two are left out. A part that cannot be measured (no audio consent, no activity data) is left out too, so nobody is marked down for something that was never measured.',
      'Use it to decide who to talk to, not to decide anything on its own. Meetings, calls, approved leave and a muted mic by mistake can all lower a score.',
    ],
  },
  {
    id: 'admin-screenshots',
    title: 'For admins: the Screenshots page',
    roles: ADMIN,
    body: [
      'Screenshots in the menu shows everyone’s screenshots in one place, one block per person. It starts on today; Today, Yesterday and Last 7 days at the top change the dates in one click, or use From and To. Employee is a searchable dropdown (type to narrow the list, then pick a name), and Department shows one team. Screenshots are shown up to 7 days at a time.',
      'The numbers at the top say how many people have screenshots and how many screenshots there are in all. Jump to takes you to one person. With many people the list is split into pages: use Next people and Previous people.',
      'Each screenshot stays closed until you click it, so looking is a decision, and every one you open is recorded in the audit log with your name and theirs. Open all opens a person’s whole set and records each. People who have Blur screenshots switched on stay blurred until you click. Opening a person’s name takes you to their own page for their day in full.',
      'Only HR / Admin can use this page. The Timesheet page shows the same screenshots under the live hours if you want both together.',
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
      'Payroll: choose the month, Generate to work out each person’s full days, half days, other hours and pay from closed shifts and their pay rates, then print or email payslips and Export CSV. Generating again for the same month is safe, it updates rather than duplicates. Review flagged and auto-closed shifts first. See "For admins: pay rates, bonuses and payslips".',
      'Leave requests shows every request in the company, with proof files, for approval or rejection.',
    ],
  },
  {
    id: 'admin-rollout',
    title: 'For admins: rolling out the desktop agent',
    roles: ADMIN,
    body: [
      'Employees need the WorkInvigilator agent on the computer they work on. Once the installer link is configured for the portal, a Download button appears on every employee’s Help and My shift pages.',
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
      '4. Check that everyone has a pay rate (Payroll → Pay rates) and add the month’s bonuses (Payroll → Bonuses).',
      '5. Open Payroll, choose the month and click Generate. Generating again for the same month updates the figures, it never duplicates them. If you change a rate or fix a shift afterwards, click Regenerate.',
      '6. Look for the orange "no pay rate" warning: days with no rate are paid nothing until a rate that covers them is set and the month is regenerated.',
      '7. Open a few payslips to check them, then use Email all payslips (or Email on one row). Every row shows Sent, Queued or Failed.',
      '8. Export CSV and keep the file with your payroll records.',
      '9. When the figures are final, click Finalize month. Payslips are frozen, employees are notified and can see theirs under Payslips. If you must change something later, use Reopen month.',
      '10. Click Payment list (CSV) for the list of who to pay and how much, pay them, and note the date, method and reference in the last three columns.',
    ],
  },
  {
    id: 'admin-leave-holiday',
    title: 'For admins: paid leave and holidays in pay',
    roles: ADMIN,
    body: [
      'Paid leave: approved leave of a paid type is paid at the daily rate, on working days only (half for a half-day leave). Company Vacation is paid by default; Settings → Payroll lets you choose which types are paid. Pending and rejected requests are never paid.',
      'Working days: Settings → Payroll → Working days (Monday to Friday by default). Leave and holidays only count on these days, so a vacation from Friday to Tuesday pays Friday, Monday and Tuesday but not the weekend.',
      'Sunday is always a day off. Nobody can punch in on a Sunday, from the portal, the desktop agent or the phone, and it is never paid. It cannot be changed.',
      'Holidays: Payroll → Holidays shows a year calendar (Sundays shaded, holidays coloured). Click a day to mark it as a holiday, or click a holiday to change it; you can also upload a CSV (date, name). Nobody can punch in on a holiday. Each holiday is paid at the daily rate to everyone who is active, has a pay rate and had joined by that date. A holiday on a day that is not a working day is not paid.',
      'Holidays repeat every year: the next year’s calendar fills itself in with the same dates the first time anyone looks at it (the calendar, payroll for that year, or a punch-in). Those copies are marked "Copied from last year": check the date (a festival that moves, say), then click Keep or Edit. Untick Repeats for a one-off. Removing a holiday also removes it from later years that have not been created yet.',
      'Everyone can see the company calendar under Calendar in the menu (see "The calendar"). HR can mark holidays straight on the month view.',
      'Birthdays: open an employee, choose Edit details and set the Birthday (you can also give it when adding the employee). It shows on the Holidays calendar for HR as a gold dot, with the name on hover, and in the Birthdays list under it. Only active employees appear: deactivate someone and their birthday leaves the calendar. Clear the date to remove it. The year of birth is never shown on the calendar.',
      'Birthday reminders: HR and the employee’s team leader get a notification the day before and again on the day (the red number next to Notifications). The birthday person is not told. A leader’s or HR’s own birthday goes to HR only. On 29 February birthdays, non-leap years use 28 February.',
      'A day is never paid more than once: leave or a holiday only pays the part of the day that was not worked, and a holiday that falls inside a vacation is paid once.',
      'These appear on the payslip as Paid leave and Holidays. Someone with no shifts in the month but paid leave or a holiday still gets a payroll row. Regenerate the month after changing leave, holidays or these settings.',
    ],
  },
  {
    id: 'admin-account-admin',
    title: 'For admins: account admin (who sees payroll and payments)',
    roles: ADMIN,
    body: [
      'Payroll and payments are only for an Account admin: pay rates, bonuses, the Payroll page, payslips and emailing them, finalizing a month, the payroll CSV, the Payment list, employees’ bank details, and the payroll settings and payslip template in Settings. An HR admin who is not an account admin does not see the Payroll menu or any of this, and the server refuses them even if they type the address.',
      'An account admin can do everything an HR admin can, plus the above. The company holidays and the Calendar are shared: both kinds of admin can mark and change holidays. Pay itself still reaches employees as before: each person sees their own payslip under Payslips once the month is finalized.',
      'Make someone an account admin: open the person (they must be an HR / Admin), choose Edit details and tick Account admin (or tick it when adding the admin). Any HR / Admin can give the right to someone else, but not to themselves; only an account admin can take it away (untick it). Every change is recorded in the audit log, and every other account admin and the person themselves get a notification, so it never happens quietly. Only an account admin can reset the password, change the role or deactivate another account admin.',
      'Be careful whom you let give the right: an HR admin who can add admins can add one for themselves and give it to that account. That is why every grant is audited and announced. If you want only account admins to decide, do not use the HR admin accounts for adding admins.',
      'There is always at least one active account admin: the last one cannot be switched off, demoted or deactivated until another is chosen.',
      'The first time this was switched on, every existing admin became an account admin so nobody lost access. If some HR admins should not see payroll, untick Account admin for them.',
    ],
  },
  {
    id: 'admin-finalize',
    title: 'For admins: finalizing and reopening a month',
    roles: ADMIN,
    body: [
      'Finalize month (Payroll page): freezes every payslip for the month exactly as it is now. The month can no longer be regenerated, and its bonuses and holidays cannot change. Each employee gets a notification and can see their own payslip under Payslips. Until you finalize, employees see nothing.',
      'Before it freezes, WorkInvigilator checks the payslips are up to date (if a rate or shift changed after you generated, it asks you to Regenerate first) and warns about shifts still open and days with no pay rate. You can go ahead after confirming.',
      'A finalized payslip never changes, whatever happens later: a new rate, a corrected shift or new settings do not touch it. Emails and PDFs use the frozen figures.',
      'Payment list (CSV): once a month is finalized, the Payroll page shows a Payment list (CSV) button. It lists everyone to be paid this month and how much (days, base pay, bonus and the amount to pay) and where to pay them (bank, branch, account name and number), with a TOTAL line at the end, taken from the frozen payslips so it always matches what employees see. People with nothing to be paid are left off; people with no bank details are marked NO BANK DETAILS (the Payroll page names them first). The last three columns (Paid On, Payment Method, Reference) are empty for you to fill in as you pay. It is not available before the month is finalized, because the figures could still change. WorkInvigilator does not move any money: you upload the file to your bank (or copy the details into its bulk-payment template) and approve it there.',
      'Bank details: open an employee and use the Bank details card (Add bank details, Edit, Remove). They are stored encrypted. The account number shows as ****1234 until you click Show account number. Only HR can see them, and every look, change and payment-file download is recorded in the audit log (never the account number itself). Opening the CSV in Excel can drop leading zeros of an account number: import the column as Text, or open it in Google Sheets. The payment file holds full account numbers, so keep it private and delete it once the bank has paid.',
      'Reopen month: unfreezes it so you can regenerate or change bonuses. You must give a reason, which is kept in the audit log. Employees stop seeing that month until you finalize it again.',
    ],
  },
  {
    id: 'admin-pay',
    title: 'For admins: pay rates, bonuses and payslips',
    roles: ADMIN,
    body: [
      'Pay rates (Payroll → Pay rates): each person has a daily rate in US dollars. Click Set rate or Raise / history, enter the new daily rate and the date it starts. A raise is simply a new rate with a later start date: every day is paid at the rate in force on that day, so a raise in the middle of a month splits the month correctly.',
      'Entered a rate wrongly? Open the person’s history and Edit it. A rate dated in the past applies to old days once you regenerate that month.',
      'Many at once: Upload a spreadsheet. Download the template, fill one row per person and start date (email, daily_rate, effective_from as YYYY-MM-DD, optional note), save as CSV and upload it. People are matched by email. A row for a date that already has a rate replaces it.',
      'Bonuses (Payroll → Bonuses): pick the month, choose the person, an amount and a reason. Several bonuses for one person are fine, and you can remove a wrong one. Bonuses are added when read, so one added after generating still shows without regenerating. They can also be uploaded as a CSV (email, month, amount, reason).',
      'A bulk upload is all or nothing: if any row is wrong, nothing is saved and the screen lists the rows to fix. Upload again once the sheet is corrected.',
      'Payslip: open Payroll, then Payslip on a person’s row. It shows total hours, full days, half days, other hours, the earnings, bonuses and net pay, and can be printed or saved as a PDF. It warns you if a rate or shift changed after the month was generated.',
      'Email: Email all payslips sends everyone’s for the month; the Email button on a row sends one. Each person gets only their own, at the address on their record. A large send runs in the background, so you can leave the page: each row shows Sent, Queued or Failed (hover Failed for the reason). Email must be set up on the server first; Settings tells you if it is not.',
      'Every email carries the payslip as a PDF. The first time, the PDF is clean. If you send the same payslip to the same person again, the PDF is stamped DUPLICATE across the page and the email says "duplicate copy", so nobody can pass a repeat off as a new payslip. If the figures changed since the last send (a correction), the new one is not stamped. A send that failed does not count as sent. The row shows Sent ×2, ×3 and so on; you are asked to confirm before a repeat.',
      'Download PDF on a payslip gives you your own copy of the PDF. It is never stamped DUPLICATE. In the PDF, characters outside basic Latin letters (for example Tamil) appear as question marks.',
    ],
  },
  {
    id: 'admin-pay-rules',
    title: 'For admins: how pay is worked out',
    roles: ADMIN,
    body: [
      'Each day’s work is the worked time of that date with breaks already taken out. Break time is never counted as work and never paid.',
      'Full day: at least 9 hours of work (the default). Pays the whole daily rate.',
      'Half day: at least 4.5 hours of work, under a full day. Pays half the daily rate.',
      'Other hours: less than a half day. Paid by the hour: the daily rate spread over a full day’s hours. The payslip shows the total of these hours.',
      'So someone who takes a break and stays late to finish 9 hours of work, and someone who takes no break and leaves after 9 hours, both get a full day. Someone with 8 hours of work gets a half day under the default limits: if your normal day is shorter, lower the full-day limit in Settings.',
      'Two shifts on the same date are added together before the day’s kind is decided. Open shifts are not counted until they are closed.',
      'A month keeps the limits it was generated with, so changing them later never alters a payslip that was already produced. Regenerate the month to apply new limits or new rates.',
    ],
  },
  {
    id: 'admin-branding',
    title: 'For admins: company logo and name',
    roles: ADMIN,
    body: [
      'Settings → Company: upload your logo (PNG, JPEG or WebP, up to 1 MB, square works best) and set the company name. They appear on payslips and in payslip emails. Replace or Remove the logo at any time.',
      'If the logo does not show in emails, the server needs its public address set (PUBLIC_API_URL). Ask whoever looks after the server.',
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
      'Ask them to uninstall WorkInvigilator from any personal computer it was installed on.',
    ],
  },
  {
    id: 'admin-settings',
    title: 'For admins: settings',
    roles: ADMIN,
    body: [
      'Settings control the company name and logo, screenshot and audio timing, target shift length, break allowance, idle threshold, auto-close time, retention days, the full-day and half-day limits for pay, and whether idle time is deducted from payroll. Changes apply to everyone, and agents pick them up with no reinstall.',
    ],
  },
  {
    id: 'glossary',
    title: 'Words used in the app',
    roles: ALL,
    body: [
      'All times in WorkInvigilator are New York time (Eastern Time), whatever country your computer is in. A "day" starts and ends at midnight New York time.',
      'Punch in / Punch out: start and end of your working day.',
      'Break: time you pause the work clock. You have a daily allowance; going over it flags the day for HR review.',
      'Flagged: a day HR should look at, for example an over-long break or a missing punch out.',
      'Auto-closed: a shift the system ended for you because you never punched out. HR confirms the real end time.',
      'Idle: no keyboard or mouse activity for a set time (10 minutes by default).',
      'No Pay Leave: leave that is not paid. Pay depends on the type of leave, not on proof: by default only Company Vacation is paid, and sick, bereavement, personal and emergency leave are No Pay Leave whether or not proof is attached.',
      'Full day, half day, other hours: how a day of work is paid. A full day is at least 9 hours of work (breaks not counted), a half day at least 4.5, and less than that is counted as hours. HR can change these limits.',
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
      'Why can I not punch in today? Sundays and company holidays are days off, so punching in is closed on them. The Calendar page in the menu shows them. If you think a day is wrong, ask HR.',
      'Where is my payslip? Open Payslips in the menu. A month’s payslip appears once HR has finalized that month, and you get a notification. You can view it, print it or download it as a PDF.',
      'Do I get paid for holidays and leave? Company holidays are paid at your daily rate. Approved leave is paid if its type is a paid one (Company Vacation by default); ask HR which types are paid. Only working days count, so a weekend inside a vacation is not paid.',
      'Is my break paid? No: a break is not counted as work. A full day needs 9 hours of work (HR can change this), so if you take a break you finish your 9 hours of work after it; if you take none you are done after 9 hours. Either way it is a full day.',
      'Can I use WorkInvigilator on my phone? You can open the portal to view history and request leave, but screenshots only come from the desktop agent.',
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
      'Install the WorkInvigilator desktop agent and leave it running in the system tray.',
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
      'Set each person’s pay rate (Payroll → Pay rates), then each month: review flags, add bonuses, Payroll → Generate, check payslips, email them, Export CSV.',
    ],
  },
};

// Sections each role should read first, in this order. Everything else follows in page order.
const ROLE_FIRST = {
  leader: ['team', 'leader-leave', 'leader-day', 'leader-flags', 'leader-privacy'],
  admin: [
    'admin-people',
    'admin-rollout',
    'admin-timesheet',
    'admin-screenshots',
    'admin-reports',
    'admin-account-admin',
    'admin-payroll-check',
    'admin-pay',
    'admin-pay-rules',
    'admin-leave-holiday',
    'admin-finalize',
    'admin-settings',
    'admin-branding',
    'admin-offboarding',
  ],
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
  warn: { label: 'Important', background: 'var(--warn-soft)', color: 'var(--warn-text)' },
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
  // The newest builds come from the update feed (see lib/latestBuilds.js), so publishing a release
  // needs no code change here. An env var still wins when one is set.
  const builds = await latestBuilds();
  const agentDownloadUrl = process.env.AGENT_DOWNLOAD_URL || builds.windows?.url || '';
  // Without a published Android build the APK served from this portal (web/public/downloads) is
  // used, so installing needs no account anywhere else.
  const androidDownloadUrl =
    process.env.ANDROID_DOWNLOAD_URL || builds.android?.url || '/downloads/WorkBuddy.apk';

  return (
    <>
      <OpenOnHash />
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p>
            How to use WorkInvigilator. You are signed in as: <strong>{ROLE_LABEL[user.role] || 'User'}</strong>.
            Questions this page does not answer? Ask HR.
          </p>
        </div>
      </div>

      <div className="stack">
        <HelpSearch />

        <div className="card card-pad" data-help-extra>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{quickStart.title}</div>
          <Steps items={quickStart.steps} />
        </div>

        <div className="card card-pad" data-help-extra>
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

        <div className="card card-pad" data-help-extra>
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
          <details key={s.id} id={s.id} className="card card-pad" open={i === 0} data-help-section>
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
