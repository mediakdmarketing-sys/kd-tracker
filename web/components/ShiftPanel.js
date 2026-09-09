'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call, post } from '@/lib/client';
import { clock, duration, time } from '@/lib/format';

// ---------------------------------------------------------------------------
// ClockDisplay
//
// Owns its own 1-second tick so only the HH:MM:SS string and the derived
// workedSeconds / breakSeconds re-render every second. The buttons, progress
// bar, break donut, and punch-in time line are unaffected.
//
// Props are "snapshot" values from the last server poll; the component adds
// elapsed seconds locally between polls so the display feels live.
// ---------------------------------------------------------------------------

const ClockDisplay = memo(function ClockDisplay({
  state,         // 'working' | 'on_break' | 'punched_out'
  baseWorked,    // workedSeconds from the last poll
  baseBreak,     // breakSeconds from the last poll
  allowance,     // breakAllowanceSeconds
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Reset tick when the server sends fresh numbers (baseWorked / baseBreak changed).
  const prevWorked = useRef(baseWorked);
  const prevBreak  = useRef(baseBreak);
  if (prevWorked.current !== baseWorked || prevBreak.current !== baseBreak) {
    prevWorked.current = baseWorked;
    prevBreak.current  = baseBreak;
    setTick(0);
  }

  const out     = state === 'punched_out';
  const working = state === 'working';
  const onBreak = state === 'on_break';

  const workedSeconds = out ? 0 : baseWorked + (working ? tick : 0);
  const breakSeconds  = out ? 0 : baseBreak  + (onBreak  ? tick : 0);
  const overBreak     = breakSeconds > allowance;

  return (
    <>
      <div className="clock-label">{out ? 'Not punched in' : 'Worked today'}</div>
      <div className="clock">{out ? '—' : clock(workedSeconds)}</div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {!out && (
          <BreakDonut used={breakSeconds} allowance={allowance} over={overBreak} />
        )}
        <span className="muted">
          {out ? (
            'Punch in to start your shift.'
          ) : (
            <>
              Break used {duration(breakSeconds)} of {duration(allowance)}
              {overBreak && (
                <span className="pill pill-flag" style={{ marginLeft: 8 }}>
                  Over the allowance — flagged for HR
                </span>
              )}
            </>
          )}
        </span>
      </div>
    </>
  );
});

// ---------------------------------------------------------------------------
// BreakDonut
//
// Pure SVG donut ring. Hovering the orange arc shows break used; hovering the
// grey arc shows break remaining. No library, no canvas.
// ---------------------------------------------------------------------------

const BreakDonut = memo(function BreakDonut({ used, allowance, over }) {
  const [tooltip, setTooltip] = useState(null);

  const SIZE = 36;
  const STROKE = 4;
  const R = (SIZE - STROKE) / 2;
  const C = SIZE / 2;
  const CIRC = 2 * Math.PI * R;

  const ratio     = Math.min(1, allowance > 0 ? used / allowance : 0);
  const usedDash  = ratio * CIRC;
  const emptyDash = CIRC - usedDash;
  const remaining = Math.max(0, allowance - used);

  const trackColor = '#e2e5ea';
  const fillColor  = over ? '#b4231f' : '#a4610a';

  const showTooltip = useCallback((e, text) => {
    const rect = e.currentTarget.closest('svg').getBoundingClientRect();
    setTooltip({ text, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ transform: 'rotate(-90deg)', cursor: 'default' }}
        aria-label={`Break: ${duration(used)} used, ${duration(remaining)} remaining`}
      >
        <circle
          cx={C} cy={C} r={R}
          fill="none"
          stroke={trackColor}
          strokeWidth={STROKE}
          style={{ cursor: 'pointer' }}
          onMouseMove={(e) => showTooltip(e, `${duration(remaining)} remaining`)}
          onMouseLeave={hideTooltip}
        />
        {usedDash > 0 && (
          <circle
            cx={C} cy={C} r={R}
            fill="none"
            stroke={fillColor}
            strokeWidth={STROKE}
            strokeDasharray={`${usedDash} ${emptyDash}`}
            strokeLinecap="round"
            style={{ cursor: 'pointer' }}
            onMouseMove={(e) => showTooltip(e, `${duration(used)} used`)}
            onMouseLeave={hideTooltip}
          />
        )}
      </svg>
      {tooltip && (
        <span
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y - 30,
            transform: 'translateX(-50%)',
            background: '#16191d',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {tooltip.text}
        </span>
      )}
    </span>
  );
});

// ---------------------------------------------------------------------------
// ShiftPanel
//
// Story W-2 — punch controls and live shift status.
//
// This component owns: server poll, action buttons, progress bar, punch-in
// time line. It does NOT own the 1-second tick — that lives in ClockDisplay
// so only the clock portion re-renders every second.
// ---------------------------------------------------------------------------

export default function ShiftPanel({ initial, timezone }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await call('/api/attendance/status'));
    } catch {
      // A dropped poll is not worth an error banner; the next one will recover.
    }
  }, []);

  useEffect(() => {
    // Poll every 5 minutes — ClockDisplay's local tick keeps the display live between polls.
    const pollTimer = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(pollTimer);
  }, [refresh]);

  const act = useCallback(async (path, label) => {
    setBusy(label);
    setError(null);
    try {
      await post(`/api/attendance/${path}`);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [refresh, router]);

  const out     = status.state === 'punched_out';
  const onBreak = status.state === 'on_break';

  const target    = status.shiftTargetSeconds    || 32400;
  const allowance = status.breakAllowanceSeconds || 3600;

  // Progress bar uses the server's last-known workedSeconds — good enough between polls.
  const workedForBar = status.workedSeconds || 0;
  const progress     = Math.min(100, (workedForBar / target) * 100);
  const overBreak    = (status.breakSeconds || 0) > allowance;

  return (
    <div className="card">
      <div className="card-pad">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}

        <div className="punch">
          {/* Clock section re-renders every second in isolation */}
          <div>
            <ClockDisplay
              state={status.state}
              baseWorked={status.workedSeconds || 0}
              baseBreak={status.breakSeconds || 0}
              allowance={allowance}
            />
          </div>

          {/* Buttons re-render only on busy / status state changes */}
          <div className="btn-row">
            {out ? (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => act('punch-in', 'in')}
                disabled={busy !== null || status.canPunchIn === false}
              >
                {busy === 'in' ? 'Punching in…' : 'Punch in'}
              </button>
            ) : (
              <>
                {onBreak ? (
                  <button
                    type="button"
                    className="btn btn-warning btn-lg"
                    onClick={() => act('break-end', 'break-end')}
                    disabled={busy !== null}
                  >
                    {busy === 'break-end' ? 'Ending…' : 'End break'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-lg"
                    onClick={() => act('break-start', 'break-start')}
                    disabled={busy !== null}
                  >
                    {busy === 'break-start' ? 'Starting…' : 'Start break'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger btn-lg"
                  onClick={() => act('punch-out', 'out')}
                  disabled={busy !== null}
                >
                  {busy === 'out' ? 'Punching out…' : 'Punch out'}
                </button>
              </>
            )}
          </div>
        </div>

        {!out && (
          <>
            <div className={`bar${overBreak ? ' over' : ''}`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="faint">
                Punched in at {time(status.shift?.punchIn, timezone)} · target {duration(target)}
              </span>
              <span className="inline">
                {onBreak ? (
                  <span className="pill pill-break">On break — nothing is being captured</span>
                ) : (
                  <span className="pill pill-working">
                    Capturing {status.audioAllowed ? 'screen and audio' : 'screen only'}
                  </span>
                )}
              </span>
            </div>
          </>
        )}

        {status.consentRequired && (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>
            You need to accept the monitoring notice before you can punch in.
          </div>
        )}
      </div>
    </div>
  );
}
