'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';

/**
 * Values are edited in whatever unit a human actually thinks in (minutes, hours, days) and
 * converted to/from the API's seconds-everywhere shape only at the edges — load and submit.
 * The API itself stays in seconds throughout (matches config.js's existing units, and every
 * other backend consumer of these values already expects seconds).
 */
export default function SettingsForm({ initial }) {
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
    retentionDays: initial.retention.days,
    deductIdle: initial.payroll.deductIdle,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
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
        },
        retention: { days: Math.round(form.retentionDays) },
        payroll: { deductIdle: form.deductIdle },
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

      <div className="card card-pad">
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12 }}>Payroll</div>
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
