'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_TZ } from '@/lib/format';

// The company runs on one clock (New York), the same one attendance dates and shifts are
// counted in, so everyone sees that time whatever their own computer says.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: DEFAULT_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: DEFAULT_TZ,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export default function NewYorkClock() {
  // Starts with the current time rather than blank, so moving between sections (each has its
  // own shell, which remounts this) never shows an empty clock. The server's seconds differ
  // from the browser's, so the text is exempt from React's hydration comparison.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="ny-clock" title="Company time (New York)" aria-label="New York time">
      <span className="ny-clock-label">New York</span>
      <span className="ny-clock-date" suppressHydrationWarning>{DATE_FORMAT.format(now)}</span>
      <span className="ny-clock-time" suppressHydrationWarning>{TIME_FORMAT.format(now)}</span>
    </div>
  );
}
