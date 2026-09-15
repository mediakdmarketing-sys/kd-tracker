'use client';

import { memo, useMemo, useState, useCallback } from 'react';
import { time } from '@/lib/format';

/**
 * Story W-6 — the screenshot viewer.
 *
 * Behaviours:
 * 1. First 10 capture groups shown collapsed by default. "Show all N" expands the rest
 *    without opening files (no audit rows written). "Open all" reveals images and writes
 *    one audit row per capture (ADR-0003).
 * 2. Tiles stay collapsed until clicked — opening is an explicit decision.
 * 3. One capture moment = one tile, even across multiple displays (ADR-0005).
 *
 * Performance notes:
 * - groupByCapture() is memoized so it only re-runs when `items` changes, not on every
 *   setRevealed / setShowAll state update.
 * - The Intl.DateTimeFormat formatter is created once per (timezone) value and passed
 *   down, instead of being constructed inside every CaptureTile render.
 * - CaptureTile is wrapped in React.memo so only the one tile that was just revealed
 *   re-renders when setRevealed fires, rather than all 128 tiles re-rendering.
 */

const INITIAL_VISIBLE = 10;

export default function ScreenshotGrid({ items, timezone, from, to, fileUrlBase, blurred = false }) {
  const rangeLabel = from && to && from !== to ? `${from} to ${to}` : from || to || '';
  const multiDay = Boolean(from && to && from !== to);
  const [revealed, setRevealed] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);

  // Memoized so the Map rebuild doesn't run on every state update.
  const groups = useMemo(() => groupByCapture(items), [items]);

  const openable = useMemo(
    () => groups.filter((g) => g.images.some((i) => !i.fileDeleted)),
    [groups]
  );

  const purgedFiles = useMemo(() => items.filter((i) => i.fileDeleted).length, [items]);
  const multiDisplay = useMemo(() => groups.some((g) => g.images.length > 1), [groups]);

  const visibleGroups = showAll ? groups : groups.slice(0, INITIAL_VISIBLE);
  const hiddenCount = groups.length - INITIAL_VISIBLE;

  // Stable formatter passed to every tile — constructed once per (timezone, multiDay) pair.
  // Avoids 128 × new Intl.DateTimeFormat(...) inside CaptureTile render. Includes the date
  // too when the view spans more than one day — two captures both timestamped "14:32" on
  // different days would otherwise be indistinguishable in the grid.
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Kolkata',
        ...(multiDay ? { month: 'short', day: '2-digit' } : {}),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [timezone, multiDay]
  );

  const reveal = useCallback(
    (id) => setRevealed((prev) => new Set(prev).add(id)),
    []
  );

  const revealAll = useCallback(() => {
    setShowAll(true);
    setRevealed(new Set(openable.map((g) => g.id)));
  }, [openable]);

  const handleShowAll = useCallback(() => setShowAll(true), []);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Screenshots</h2>
        <div className="inline">
          <span className="faint">
            {groups.length} capture{groups.length === 1 ? '' : 's'}{' '}
            {multiDay ? 'between' : 'on'} {rangeLabel}
            {multiDisplay ? ` · ${items.length} images across multiple displays` : ''}
            {purgedFiles ? ` · ${purgedFiles} file${purgedFiles === 1 ? '' : 's'} already purged` : ''}
          </span>

          {!showAll && hiddenCount > 0 && (
            <button type="button" className="btn" onClick={handleShowAll}>
              Show all {groups.length}
            </button>
          )}

          {openable.length > 0 && revealed.size < openable.length && (
            <button type="button" className="btn" onClick={revealAll}>
              Open all {openable.length}
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          No screenshots captured {multiDay ? 'in this range' : 'on this date'}.
        </div>
      ) : (
        <div className="card-pad">
          <div className="shots">
            {visibleGroups.map((group) => (
              <CaptureTile
                key={group.id}
                group={group}
                timeFmt={timeFmt}
                revealed={revealed.has(group.id)}
                onReveal={reveal}
                fileUrlBase={fileUrlBase}
                blurred={blurred}
              />
            ))}
          </div>

          {!showAll && hiddenCount > 0 && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button" className="btn" onClick={handleShowAll}>
                Show {hiddenCount} more capture{hiddenCount === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CaptureTile — memo so only the one revealed tile re-renders on setRevealed
// ---------------------------------------------------------------------------

const CaptureTile = memo(function CaptureTile({ group, timeFmt, revealed, onReveal, fileUrlBase, blurred }) {
  const available = group.images.filter((i) => !i.fileDeleted);
  const allPurged = available.length === 0;
  // Per-tile, not global: showing one screenshot clearly shouldn't unblur the other 127 —
  // whoever's looking decided this one specifically needed a closer look.
  const [showClear, setShowClear] = useState(false);
  const stillBlurred = blurred && !showClear;

  const captureTimeLabel = formatWithFmt(timeFmt, group.capturedAt);

  return (
    <figure className="shot" style={{ margin: 0 }}>
      {allPurged ? (
        <div className="shot-gone">
          File deleted under the 31-day retention rule. The record of the capture is kept.
        </div>
      ) : revealed ? (
        <div style={{ position: 'relative' }}>
          <div
            className={group.images.length > 1 ? 'shot-displays' : undefined}
            style={stillBlurred ? { filter: 'blur(14px)', transform: 'scale(1.03)' } : undefined}
          >
            {group.images.map((image) => {
              if (image.fileDeleted) return <div className="shot-gone" key={image.id}>Purged</div>;
              // fileUrlBase overrides the row's own fileUrl for callers (the leader-scoped
              // views) whose per-employee GET route differs from the admin-only one the API
              // response's fileUrl always points to (capture.service.js's shapeScreenshot).
              // A plain string, not a function: this component is 'use client' and a Server
              // Component parent cannot hand a closure across that boundary.
              const url = fileUrlBase ? `${fileUrlBase}/${image.id}` : `/bff${image.fileUrl}`;
              return (
                <a href={url} target="_blank" rel="noreferrer" key={image.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${image.displayLabel || `Display ${image.displayIndex + 1}`} at ${captureTimeLabel}`}
                    title={image.displayLabel || `Display ${image.displayIndex + 1}`}
                  />
                </a>
              );
            })}
          </div>
          {stillBlurred && (
            <button
              type="button"
              onClick={() => setShowClear(true)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                border: 0,
                background: 'rgba(26, 27, 46, 0.28)',
                color: '#fff',
                cursor: 'pointer',
                font: 'inherit',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              Blurred by default — click to view clearly
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="shot-gone"
          onClick={() => onReveal(group.id)}
          style={{
            width: '100%',
            border: 0,
            background: 'var(--surface-2)',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Open {group.images.length > 1 ? `${group.images.length} screens` : 'screenshot'}
          <br />
          <span className="faint" style={{ fontSize: 11 }}>
            recorded in the audit log
          </span>
        </button>
      )}

      <figcaption className="cap">
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{captureTimeLabel}</span>
        <span className="faint">
          {group.images.length > 1 ? `${group.images.length} screens` : ''}
        </span>
      </figcaption>
    </figure>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp with a pre-built Intl.DateTimeFormat instance. */
function formatWithFmt(fmt, iso) {
  if (!iso) return '—';
  try {
    const parts = fmt.formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    // Only present when the formatter was built with { month, day } (multi-day view) —
    // absent, this is a no-op and the single-day "HH:MM" label is unchanged.
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return month && day ? `${month} ${day}, ${time}` : time;
  } catch {
    return '—';
  }
}

/**
 * Group flat screenshot rows by captureGroupId (= one capture moment, N displays).
 * Rows arrive newest-first, primary display first — order is preserved.
 */
function groupByCapture(items) {
  const byId = new Map();
  for (const item of items) {
    const key = item.captureGroupId || item.id;
    if (!byId.has(key)) byId.set(key, { id: key, capturedAt: item.capturedAt, images: [] });
    byId.get(key).images.push(item);
  }
  return [...byId.values()];
}
