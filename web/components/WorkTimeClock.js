'use client';

import { useEffect, useRef, useState } from 'react';
import { clock } from '@/lib/format';

// ---------------------------------------------------------------------------
// WorkTimeClock
//
// The "Work Time" stat tile needs to tick in lockstep with ShiftPanel's own
// "Worked today" clock (ClockDisplay, in ShiftPanel.js) — same HH:MM:SS value,
// same second-by-second movement. It was previously a static server-rendered
// string that only changed on a full page reload, which is why it drifted out
// of sync with the live clock above it. This mirrors ClockDisplay's own tick
// logic exactly (same elapsed-seconds formula) rather than sharing state with
// it, since the two components don't have a common client-side parent.
// ---------------------------------------------------------------------------

export default function WorkTimeClock({ state, baseWorked }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Reset tick when the server sends a fresh number (baseWorked changed after a poll/refresh).
  const prevWorked = useRef(baseWorked);
  if (prevWorked.current !== baseWorked) {
    prevWorked.current = baseWorked;
    setTick(0);
  }

  const out       = state === 'punched_out';
  const working   = state === 'working';
  const workedSeconds = out ? 0 : baseWorked + (working ? tick : 0);

  return <>{clock(workedSeconds)}</>;
}
