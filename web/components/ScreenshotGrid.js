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

export default function ScreenshotGrid({ items, timezone, date, buildFileUrl }) {
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

  // Stable formatter passed to every tile — constructed once per timezone value.
  // Avoids 128 × new Intl.DateTimeFormat(...) inside CaptureTile render.
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [timezone]
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
            {groups.length} capture{groups.length === 1 ? '' : 's'} on {date}
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
        <div className="empty">No screenshots captured on this date.</div>
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
                buildFileUrl={buildFileUrl}
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

const CaptureTile = memo(function CaptureTile({ group, timeFmt, revealed, onReveal, buildFileUrl }) {
  const available = group.images.filter((i) => !i.fileDeleted);
  const allPurged = available.length === 0;

  const captureTimeLabel = formatWithFmt(timeFmt, group.capturedAt);

  return (
    <figure className="shot" style={{ margin: 0 }}>
      {allPurged ? (
        <div className="shot-gone">
          File deleted under the 31-day retention rule. The record of the capture is kept.
        </div>
      ) : revealed ? (
        <div className={group.images.length > 1 ? 'shot-displays' : undefined}>
          {group.images.map((image) =>
            image.fileDeleted ? (
              <div className="shot-gone" key={image.id}>Purged</div>
            ) : (
              <a href={buildFileUrl ? buildFileUrl(image) : `/bff${image.fileUrl}`} target="_blank" rel="noreferrer" key={image.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={buildFileUrl ? buildFileUrl(image) : `/bff${image.fileUrl}`}
                  alt={`${image.displayLabel || `Display ${image.displayIndex + 1}`} at ${captureTimeLabel}`}
                  title={image.displayLabel || `Display ${image.displayIndex + 1}`}
                />
              </a>
            )
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
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
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
