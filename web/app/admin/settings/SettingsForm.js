'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';

const LEAVE_TYPES = [
  ['vacation', 'Company Vacation'],
  ['sick', 'Sick'],
  ['bereavement', 'Bereavement'],
  ['personal', 'Personal'],
  ['emergency', 'Emergency'],
];
// Sunday is always a day off and cannot be chosen.
const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat']];

/**
 * Values are edited in whatever unit a human actually thinks in (minutes, hours, days) and
 * converted to/from the API's seconds-everywhere shape only at the edges — load and submit.
 * The API itself stays in seconds throughout (matches config.js's existing units, and every
 * other backend consumer of these values already expects seconds).
 */
export default function SettingsForm({ initial, showPayroll = true }) {
  const router = useRouter();

  const [form, setForm] = useState(() => ({
    screenshotMinMinutes: initial.capture.screenshotMinIntervalSec / 60,
    screenshotMaxMinutes: initial.capture.screenshotMaxIntervalSec / 60,
    audioDurationMinutes: initial.capture.audioSampleDurationSec / 60,
    audioGapMinutes: initial.capture.audioSampleGapSec / 60,
    shiftTargetHours: initial.shift.targetSeconds / 3600,
    breakAllowanceMinutes: initial.shift.breakAllowanceSeconds / 60,
    idleThresholdMinutes: initial.shift.idleThresholdSeconds / 60,
    autoCloseHours: initial.shift.autoCloseHours,
    zoomCameraBreakMinutes: initial.shift.zoomCameraBreakMinutes ?? 0,
    retentionDays: initial.retention.days,
    // Only account admins are sent the payroll rules (see the settings page).
    ...(showPayroll
      ? {
          deductIdle: initial.payroll.deductIdle,
          fullDayHours: initial.payroll.fullDaySeconds / 3600,
          halfDayHours: initial.payroll.halfDaySeconds / 3600,
          paidLeaveTypes: initial.payroll.paidLeaveTypes,
          workDays: initial.payroll.workDays,
        }
      : {}),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  /** Ticks or unticks one entry of a list setting (a leave type, a weekday). */
  function toggle(field, item, on) {
    setForm((f) => ({ ...f, [field]: on ? [...new Set([...f[field], item])] : f[field].filter((x) => x !== item) }));
    setSaved(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch('/api/admin/settings', {
        capture: {
          screenshotMinIntervalSec: Math.round(form.screenshotMinMinutes * 60),
          screenshotMaxIntervalSec: Math.round(form.screenshotMaxMinutes * 60),
          audioSampleDurationSec: Math.round(form.audioDurationMinutes * 60),
          audioSampleGapSec: Math.round(form.audioGapMinutes * 60),
        },
        shift: {
          targetSeconds: Math.round(form.shiftTargetHours * 3600),
          breakAllowanceSeconds: Math.round(form.breakAllowanceMinutes * 60),
          idleThresholdSeconds: Math.round(form.idleThresholdMinutes * 60),
          autoCloseHours: Math.round(form.autoCloseHours),
          zoomCameraBreakMinutes: Math.round(form.zoomCameraBreakMinutes),
        },
        retention: { days: Math.round(form.retentionDays) },
        ...(showPayroll
          ? {
              payroll: {
                deductIdle: form.deductIdle,
                fullDaySeconds: Math.round(form.fullDayHours * 3600),
                halfDaySeconds: Math.round(form.halfDayHours * 3600),
                paidLeaveTypes: form.paidLeaveTypes,
                workDays: form.workDays,
              },
            }
          : {}),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Screenshots</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <NumberField
            label="Minimum interval (minutes)"
            value={form.screenshotMinMinutes}
            onChange={(v) => set('screenshotMinMinutes', v)}
            min={0.5}
            max={60}
            step={0.5}
            disabled={busy}
            hint="Agents pick a random point between min and max for each capture."
          />
          <NumberField
            label="Maximum interval (minutes)"
            value={form.screenshotMaxMinutes}
            onChange={(v) => set('screenshotMaxMinutes', v)}
            min={0.5}
            max={60}
            step={0.5}
            disabled={busy}
          />
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Audio sampling</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <NumberField
            label="Sample length (minutes)"
            value={form.audioDurationMinutes}
            onChange={(v) => set('audioDurationMinutes', v)}
            min={0.5}
            max={30}
            step={0.5}
            disabled={busy}
          />
          <NumberField
            label="Gap between samples (minutes)"
            value={form.audioGapMinutes}
            onChange={(v) => set('audioGapMinutes', v)}
            min={0.5}
            max={60}
            step={0.5}
            disabled={busy}
            hint="Non-overlapping by design: length + gap is the full cycle."
          />
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Shift &amp; breaks</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <NumberField
            label="Target shift length (hours)"
            value={form.shiftTargetHours}
            onChange={(v) => set('shiftTargetHours', v)}
            min={0.5}
            max={16}
            step={0.5}
            disabled={busy}
          />
          <NumberField
            label="Break allowance (minutes)"
            value={form.breakAllowanceMinutes}
            onChange={(v) => set('breakAllowanceMinutes', v)}
            min={0}
            max={240}
            step={5}
            disabled={busy}
          />
          <NumberField
            label="Idle threshold (minutes)"
            value={form.idleThresholdMinutes}
            onChange={(v) => set('idleThresholdMinutes', v)}
            min={1}
            max={60}
            step={1}
            disabled={busy}
            hint="No activity ping for this long marks the span as idle."
          />
          <NumberField
            label="Auto-close abandoned shifts after (hours)"
            value={form.autoCloseHours}
            onChange={(v) => set('autoCloseHours', v)}
            min={1}
            max={48}
            step={1}
            disabled={busy}
            hint="A shift still open this long after punch-in is auto-closed and flagged."
          />
          <NumberField
            label="Camera off in Zoom starts a break after (minutes)"
            value={form.zoomCameraBreakMinutes}
            onChange={(v) => set('zoomCameraBreakMinutes', v)}
            min={0}
            max={120}
            step={1}
            disabled={busy}
            hint="Windows only. 0 = off. The person is warned first, and the break ends when the camera comes on or the meeting ends. Break time is not paid, so turn this on knowingly."
          />
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Retention</div>
        <NumberField
          label="Erase screenshots &amp; audio after (days)"
          value={form.retentionDays}
          onChange={(v) => set('retentionDays', v)}
          min={1}
          max={365}
          step={1}
          disabled={busy}
          hint="The database record of a capture is always kept — only the file is deleted."
        />
      </div>

      {showPayroll && (
      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Payroll</div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
          <NumberField
            label="Full day = at least (hours of work)"
            value={form.fullDayHours}
            onChange={(v) => set('fullDayHours', v)}
            min={1}
            max={16}
            step={0.25}
            disabled={busy}
            hint="Work time with breaks taken out. Pays the whole daily rate."
          />
          <NumberField
            label="Half day = at least (hours of work)"
            value={form.halfDayHours}
            onChange={(v) => set('halfDayHours', v)}
            min={0.25}
            max={12}
            step={0.25}
            disabled={busy}
            hint="Pays half the daily rate. Less than this is paid by the hour."
          />
        </div>
        <p className="faint" style={{ margin: '0 0 16px' }}>
          Break time is never counted as work, so someone who takes a break and stays late to finish
          their hours gets a full day, the same as someone who takes none and leaves on time. Work
          on a day that is neither full nor half is paid by the hour (the daily rate spread over a
          full day&apos;s hours). A month&apos;s payslips keep the limits they were generated with.
        </p>

        <div style={{ fontWeight: 650, fontSize: 13, margin: '4px 0 6px' }}>Paid leave</div>
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Approved leave of these types is paid at the daily rate (half for a half-day leave), only on working days.
        </p>
        <div className="inline" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          {LEAVE_TYPES.map(([key, label]) => (
            <label key={key} className="inline" style={{ gap: 6, cursor: busy ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={form.paidLeaveTypes.includes(key)}
                disabled={busy}
                onChange={(e) => toggle('paidLeaveTypes', key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>

        <div style={{ fontWeight: 650, fontSize: 13, margin: '4px 0 6px' }}>Working days</div>
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Paid leave and holidays only count on these days, so a vacation that covers a weekend does not pay the weekend.
          Sunday is always a day off: nobody can punch in on it and it is never paid.
        </p>
        <div className="inline" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          {WEEKDAYS.map(([n, label]) => (
            <label key={n} className="inline" style={{ gap: 6, cursor: busy ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={form.workDays.includes(n)}
                disabled={busy}
                onChange={(e) => toggle('workDays', n, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>

        <label className="inline" style={{ gap: 8, cursor: busy ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={form.deductIdle}
            onChange={(e) => set('deductIdle', e.target.checked)}
            disabled={busy}
          />
          Deduct idle time from paid hours
        </label>
        <p className="faint" style={{ marginTop: 6 }}>
          Off by default — idle time is reported for visibility but not deducted. Change only
          after communicating the policy to employees.
        </p>
      </div>
      )}

      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {saved && !error && (
        <div className="notice notice-info">
          Saved. Screenshot and audio changes reach running desktop agents automatically on
          their next check-in — no restart needed.
        </div>
      )}

      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange, min, max, step, disabled, hint }) {
  return (
    <div className="field" style={{ margin: 0 }}>
      <label>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        required
      />
      {hint && <span className="faint" style={{ fontSize: 12 }}>{hint}</span>}
    </div>
  );
}
