'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * From / To month pickers for the dashboard.
 *   - From can be any month up to the current one (never the future).
 *   - To can only be From or later, and never later than the current month.
 * The inputs enforce this with min/max, and the handlers re-check it so a typed value cannot
 * slip past the picker.
 */
export default function MonthFilter({ from: initialFrom, to: initialTo, maxMonth }) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function changeFrom(value) {
    if (!value) return;
    const next = value > maxMonth ? maxMonth : value;
    setFrom(next);
    // Keep To inside [From, current month]: pulled forward when From passes it.
    if (to < next) setTo(next);
  }

  function changeTo(value) {
    if (!value) return;
    setTo(value > maxMonth ? maxMonth : value < from ? from : value);
  }

  function apply(event) {
    event.preventDefault();
    router.push(`/admin/dashboard?${new URLSearchParams({ from, to })}`);
  }

  return (
    <form className="filters" onSubmit={apply}>
      <div className="field">
        <label htmlFor="from">From</label>
        <input
          id="from"
          type="month"
          value={from}
          max={maxMonth}
          required
          onChange={(e) => changeFrom(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="to">To</label>
        <input
          id="to"
          type="month"
          value={to}
          min={from}
          max={maxMonth}
          required
          onChange={(e) => changeTo(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Apply
      </button>
    </form>
  );
}
