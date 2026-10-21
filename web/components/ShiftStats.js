'use client';

import { useEffect, useState } from 'react';
import { clock, duration } from '@/lib/format';

// ---------------------------------------------------------------------------
// ShiftStats
//
// The four tiles under the punch panel (Required work, Work time, Break time, Time remaining).
//
// They used to be rendered once on the server, so they froze whenever the punch panel above
// them moved on: a poll, or a break ended from the desktop agent, updated "Worked today" but
// left the tiles behind and the two clocks drifted apart. ShiftPanel now announces every status
// it receives as a `workbuddy:status` event; these tiles take that same status and keep their
// own 1-second tick from it, so both always show the same numbers.
// ---------------------------------------------------------------------------

export const STATUS_EVENT = 'workbuddy:status';

/** Whole-hours target reads as "8h", not "8h 00m". */
function hoursLabel(seconds) {
  const h = Math.floor((seconds || 0) / 3600);
  const m = Math.round(((seconds || 0) % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function minutesLabel(seconds) {
  return `${Math.round((seconds || 0) / 60)}m`;
}

function snapshot(status, fallbackBreakSeconds) {
  return {
    state: status.state,
    worked: status.workedSeconds || 0,
    breakSeconds: status.breakSeconds ?? fallbackBreakSeconds,
    target: status.shiftTargetSeconds ?? 32400,
    allowance: status.breakAllowanceSeconds ?? 3600,
  };
}

export default function ShiftStats({ initial, fallbackBreakSeconds = 0 }) {
  const [snap, setSnap] = useState(() => snapshot(initial, fallbackBreakSeconds));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onStatus(event) {
      if (!event.detail) return;
      setSnap((prev) => snapshot(event.detail, prev.breakSeconds));
      // The new numbers already include everything up to now, so restart the local tick.
      setTick(0);
    }
    window.addEventListener(STATUS_EVENT, onStatus);
    return () => window.removeEventListener(STATUS_EVENT, onStatus);
  }, []);

  const out = snap.state === 'punched_out';
  const working = snap.state === 'working';
  const onBreak = snap.state === 'on_break';

  const worked = snap.worked + (working ? tick : 0);
  const breakSeconds = snap.breakSeconds + (onBreak ? tick : 0);
  const remaining = Math.max(snap.target - worked, 0);
  const targetReached = !out && remaining === 0 && worked > 0;

  return (
    <div className="grid grid-stats">
      <div className="stat">
        <div className="label">Required Work</div>
        <div className="value">{hoursLabel(snap.target)}</div>
      </div>

      <div className="stat">
        <div className="label">Work Time</div>
        <div className="value">{clock(worked)}</div>
      </div>

      <div className="stat">
        <div className="label">Break Time</div>
        <div className="value">{minutesLabel(breakSeconds)}</div>
        <div className="sub">Allowed: {minutesLabel(snap.allowance)}</div>
      </div>

      <div className="stat">
        <div className="label">Time Remaining</div>
        <div className="value" style={targetReached ? { color: 'var(--ok)' } : undefined}>
          {targetReached ? 'Done' : duration(remaining)}
        </div>
      </div>
    </div>
  );
}
