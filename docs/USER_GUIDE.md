# WorkBuddy — User Guide

WorkBuddy tracks attendance and work activity for remote teams. There are three kinds of account, and
each one sees a different set of pages:

| Role | Who | What they do |
|---|---|---|
| **Employee** | Everyone on the team | Punch in/out, take breaks, request leave, see their own history |
| **Leader** | A team lead of one or more departments | Everything an employee does, plus watch their own team and approve its leave |
| **Admin / HR** | HR and company admins | Everything, plus employees, departments, reports, payroll, settings and the audit log |

The portal address is the Vercel URL your admin gives you. The desktop agent is a small app that runs on
the employee's computer and does the screenshots and activity counting.

---

## 1. Things everyone needs to know

### Signing in
1. Open the portal and sign in with your **work email** and password.
2. Wrong password shows a red message on the sign-in page. Too many wrong attempts blocks sign-in for about 15 minutes.
3. Forgot your password? Ask HR — they can reset it from your employee page.
4. Use **Sign out** (bottom of the left menu) on a shared computer.

### First sign-in: the monitoring notice
Before your first shift you must read and accept the notice. It says:

- **Screenshots** are taken at random times, every 5–10 minutes, **only while you are punched in and not on a break**.
- **Activity counts** are the number of keystrokes and mouse actions and the name of the active app. What you type is **never** captured.
- **Audio samples** are **optional**. Off unless you tick the second box. You can turn it off later.
- Screenshots and audio are **deleted automatically after 31 days** (HR can change this period). Only the fact that a capture happened is kept.
- Only HR/Admin (and a leader for their own team) can view captured media, and every view is written to an audit log.
- It is used for attendance and payroll, not for ranking individuals.

You cannot punch in until the monitoring box is ticked. Monitoring consent can only be withdrawn through HR.

### The desktop agent
Screenshots come from the desktop agent, not the browser.

1. Install and start the agent on your computer (your admin gives you the installer).
2. Sign in to the **portal** in your browser. The agent shows a **"Sign this desktop agent in from the web portal?"** box — click **Connect**. (Click **Cancel** if you did not just sign in.)
3. Or sign in inside the agent window with the same email and password.
4. Leave the agent running. It sits in the system tray (bottom-right, `^` arrow on Windows).

Capture only happens when **all** of these are true:
- the agent is signed in as you,
- you are **punched in** on the portal,
- you are **not on a break**,
- you have accepted the monitoring notice.

Pictures taken while offline are queued and uploaded when the connection returns.

---

## 2. Employee guide

Your menu: **My shift**, **My history**, **Leave**.

### My shift (daily use)
| Action | What it does |
|---|---|
| **Punch in** | Starts your shift. The agent starts capturing straight away. |
| **Start break** | Pauses capture and the work clock. |
| **End break** | Resumes work. |
| **Punch out** | Ends your shift. Capture stops. |

Good to know:
- The panel shows worked time, break time and whether capture is running ("Capturing screen only" or "screen and audio").
- Your break allowance (default 60 minutes a day) is shown. Going over it flags the day for HR review. You get a reminder when a break has run over.
- If you forget to punch out, the system closes the shift automatically after the configured time (default 16 hours after punch-in) and flags it for HR to confirm the real end.
- Punching in on the portal or in the agent is the same thing — either one updates the other within about 20 seconds.
- **Working on** (only shown when HR has created projects): choose the project you are on so your time is counted against it. "Unassigned time" is the default.

### My history
Your past shifts by date: punch in/out, worked time, breaks, and any flag HR added. Use the date filter to change the range.

### Leave
1. Open **Leave** and fill in the request form:
   - **Type**: Sick, Bereavement, Personal, Emergency, or Company Vacation (Paid).
   - **Day part**: Full day, Half day (AM) or Half day (PM). A half day is always one date.
   - **Start / End date** and an optional **reason**.
   - **Proof** (photo or PDF, max 5 MB): **required** for Sick, Bereavement and Emergency leave.
2. Submit. The request shows as **Pending**.
3. Your leader or HR approves or rejects it; the status updates on the same page.
4. You can **cancel** a request that is still pending.

### If something looks wrong
| Problem | Try this |
|---|---|
| "Session ended" or sent back to sign-in | Sign in again. |
| Page flashes and reloads | Normal when a reply is interrupted — it recovers by itself. |
| First load is slow after a quiet period | The server wakes up on first use (free hosting). Wait up to a minute. |
| Punched in but no screenshots | Check the agent is running and signed in, you are not on a break, and ask HR to look at "Live board". |

---

## 3. Leader guide

Your menu: **Me** (shift, history, leave — same as an employee) and **Team**:
**My team**, **Live board**, **Leave requests**.

A leader is an employee that HR has assigned as the leader of one or more departments. If **My team** says "You have not been assigned as a leader of any department yet", ask HR.

### My team
Each department you lead, with its members and how many are **working now**. **View live** opens the live board for that department.

### Live board
Who is working, on a break, or punched out right now, with their worked time. Click a name for the member's detail.

### Member detail
For one team member, with a date or date-range filter:
- **Attendance**: punch times, worked time, breaks, overtime against the target shift length, flags.
- **Screenshots** and **audio samples** (if the employee agreed to audio).
- **Activity**: keystroke/mouse counts and the apps used, with an average activity level.
- **Project time** (single day only).

Please treat this as sensitive. Looking at captured media is recorded against your name.

### Leave requests
Tabs: **Pending**, **Approved**, **Rejected**, **All**. Open a request to see the dates, reason and proof, then **Approve** or **Reject** it.

---

## 4. Admin / HR guide

Your menu has everything: **Me**, **Overview** (Live board, Productivity, Reports), **People** (Employees, Departments, Projects) and **Operations** (Payroll, Leave requests, Audit log, Settings).

### Set-up order (new company)
1. **Settings** — check shift length, break allowance, capture intervals, retention.
2. **Departments** — create them.
3. **Employees** — add people, then assign leaders.
4. **Projects** — only if you want project time tracking.
5. Give each employee the portal link and the desktop agent.

### Employees
- **Add employee**: name, work email, starting password, role (Employee / Leader / Admin), department and an employee code.
  Tell the employee to keep the password private. They accept the monitoring notice on first sign-in.
- Open an employee to:
  - see their attendance, screenshots, audio and activity (all viewing is audited),
  - **Edit role & department**,
  - **Reset password**,
  - **Blur screenshots** — turns on blurring for that person's screenshots,
  - **Deactivate** — the account is locked and every session is signed out,
  - **Assign / remove as leader** of a department.
- HR cannot grant audio consent on someone's behalf; only the employee can.

### Departments
Create and delete departments. A department's leader is set on the leader's employee page.

### Projects
Create projects (name and client) and archive them when finished. Employees then see the **Working on** picker. If there are no projects the picker is hidden.

### Live board
Everyone who is working, on break, or out right now, with live worked time.

### Productivity
A score per employee for a chosen period (Today / 7 days / 30 days or a custom range), filterable by department.
Bands: **60+ Good**, **50–59 Average**, **below 50 Review**. Use it as a conversation starter, not a verdict.
The category editor lets you mark apps/sites as productive or not.

### Reports
Choose a date range and optionally a department. You get days present, worked time, breaks, idle time and flagged days per employee, with totals. **Export CSV** downloads it.

### Payroll
1. Choose the **month**.
2. **Generate** summarises closed shifts into monthly hours. Running it again for the same month is safe — it updates rather than duplicating.
3. **Export CSV** for your payroll provider.
4. "Deduct idle time" (in Settings) decides whether idle time reduces paid hours.

Shifts that were auto-closed or flagged should be reviewed before you generate payroll.

### Leave requests
All requests across the company, with tabs for Pending, Approved, Rejected and All. Open one to read the reason, view the proof and approve or reject.

### Audit log
A permanent record of who looked at which employee's data and when (screenshots, audio, attendance history). It cannot be edited or deleted. Filter by date and action.

### Settings
| Setting | What it controls |
|---|---|
| Screenshot min / max interval | The random gap between screenshots (default 5–10 min) |
| Audio sample length and gap | Length of each recording and the pause between (default 5 + 8 min) |
| Target shift length | Used for overtime (default 9 h) |
| Break allowance | Daily break time before a day is flagged (default 60 min) |
| Idle threshold | How long with no activity counts as idle (default 10 min) |
| Auto-close abandoned shifts after | Closes and flags a shift left open (default 16 h) |
| Retention days | When screenshots and audio are erased (default 31) |
| Deduct idle in payroll | Whether idle time reduces paid hours |

Changes apply to everyone; agents pick them up automatically with no reinstall.

### Good practice
- Create one admin account per HR person, not a shared one.
- Use strong, unique passwords (12+ characters) and reset any password that has been shared.
- Tell employees what is captured before they start — the in-app notice does this, but say it out loud too.
- Review flagged days weekly, before payroll.

---

## 5. Who can see and do what

| | Employee | Leader | Admin |
|---|---|---|---|
| Punch in/out, breaks, own history | ✅ | ✅ | ✅ |
| Request / cancel own leave | ✅ | ✅ | ✅ |
| Live board for their team | ❌ | ✅ (own departments) | ✅ (everyone) |
| Member attendance, screenshots, audio, activity | ❌ | ✅ (own team) | ✅ (everyone) |
| Approve / reject leave | ❌ | ✅ (own team) | ✅ (everyone) |
| Add / edit / deactivate employees | ❌ | ❌ | ✅ |
| Departments, projects, leader assignment | ❌ | ❌ | ✅ |
| Reports, productivity, payroll | ❌ | ❌ | ✅ |
| Settings and audit log | ❌ | ❌ | ✅ |

---

## 6. Quick FAQ

**Is my screen recorded continuously?** No. A screenshot is taken at a random time every 5–10 minutes while you are punched in and not on a break.

**Is what I type recorded?** No. Only counts of keystrokes and mouse actions, plus the app name.

**Are screenshots taken on a break or after punch-out?** No.

**Can I turn audio off?** Yes, on the monitoring notice page, any time.

**How long are screenshots kept?** 31 days by default, then deleted.

**Who looked at my data?** Everyone's views are in the audit log, which HR can show you.
