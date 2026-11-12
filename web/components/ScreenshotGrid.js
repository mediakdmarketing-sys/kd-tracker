'use client';

import { memo, useMemo, useState, useCallback } from 'react';

/**
 * Story W-6 — the screenshot viewer.
 *
 * Behaviours:
 * 1. First 10 capture groups shown collapsed by default. "Show all N" expands the rest
 *    without opening files (no audit rows written). "Open all" reveals images and writes
 *    one audit row per capture (ADR-0003).
 * 2. Tiles stay collapsed until clicked — opening is an explicit decision.
 * 3. One capture moment = one tile, even across multiple displays (ADR-0005).
 * 4. When the gap between consecutive captures exceeds 1.5× the max screenshot interval,
 *    repeat tiles are inserted so the grid has no silent gaps — the last known screen
 *    state is shown dimmed with a "Repeated" label rather than leaving a blank period.
 *
 * Performance notes:
 * - groupByCapture() is memoized so it only re-runs when `items` changes, not on every
 *   setRevealed / setShowAll state update.
 * - The Intl.DateTimeFormat formatter is created once per (timezone, multiDay) value and
 *   passed down, instead of being constructed inside every CaptureTile render.
 * - CaptureTile is wrapped in React.memo so only the one tile that was just revealed
 *   re-renders when setRevealed fires, rather than all 128 tiles re-rendering.
 */

const INITIAL_VISIBLE = 10;
// 1.5× the max interval before we consider a gap "missed" and insert a repeat tile.
const GAP_FACTOR = 1.5;

export default function ScreenshotGrid({
  items,
  timezone,
  from,
  to,
  fileUrlBase,
  blurred = false,
  maxIntervalSec = 600,
}) {
  const rangeLabel = from && to && from !== to ? `${from} to ${to}` : from || to || '';
  const multiDay = Boolean(from && to && from !== to);
  const [revealed, setRevealed] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);

  // Memoized so the Map rebuild doesn't run on every state update.
  const realGroups = useMemo(() => groupByCapture(items), [items]);

  // Fill gaps: when consecutive captures are more than GAP_FACTOR × maxInterval apart,
  // insert phantom "repeat" tiles that show the last real screenshot dimmed.
  const groups = useMemo(
    () => fillGaps(realGroups, maxIntervalSec * GAP_FACTOR * 1000),
    [realGroups, maxIntervalSec]
  );

  const realCount = realGroups.length;
  const repeatCount = groups.filter((g) => g.isRepeat).length;

  const openable = useMemo(
    () => groups.filter((g) => !g.isRepeat && g.images.some((i) => !i.fileDeleted)),
    [groups]
  );

  const purgedFiles = useMemo(() => items.filter((i) => i.fileDeleted).length, [items]);
  const multiDisplay = useMemo(() => groups.some((g) => g.images.length > 1), [groups]);

  const visibleGroups = showAll ? groups : groups.slice(0, INITIAL_VISIBLE);
  const hiddenCount = groups.length - INITIAL_VISIBLE;

  // Stable formatter passed to every tile — constructed once per (timezone, multiDay) pair.
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'America/New_York',
        ...(multiDay ? { month: 'short', day: '2-digit' } : {}),
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [timezone, multiDay]
  );

  const reveal = useCallback((id) => setRevealed((prev) => new Set(prev).add(id)), []);

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
            {realCount} capture{realCount === 1 ? '' : 's'}{' '}
            {multiDay ? 'between' : 'on'} {rangeLabel}
            {multiDisplay ? ` · ${items.length} images across multiple displays` : ''}
            {purgedFiles ? ` · ${purgedFiles} file${purgedFiles === 1 ? '' : 's'} already purged` : ''}
            {repeatCount > 0 ? ` · ${repeatCount} repeated (no new capture)` : ''}
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

      {realCount === 0 ? (
        <div className="empty">
          No screenshots captured {multiDay ? 'in this range' : 'on this date'}.
        </div>
      ) : (
        <div className="card-pad">
          <div className="shots">
            {visibleGroups.map((group) =>
              group.isRepeat ? (
                <RepeatTile
                  key={group.id}
                  group={group}
                  timeFmt={timeFmt}
                  fileUrlBase={fileUrlBase}
                  blurred={blurred}
                />
              ) : (
                <CaptureTile
                  key={group.id}
                  group={group}
                  timeFmt={timeFmt}
                  revealed={revealed.has(group.id)}
                  onReveal={reveal}
                  fileUrlBase={fileUrlBase}
                  blurred={blurred}
                />
              )
            )}
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
// RepeatTile — shown when a gap in captures is detected; repeats the last image
// ---------------------------------------------------------------------------

const RepeatTile = memo(function RepeatTile({ group, timeFmt, fileUrlBase, blurred }) {
  const captureTimeLabel = formatWithFmt(timeFmt, group.capturedAt);
  // Show the first non-deleted image from the source group, dimmed.
  const sourceImage = group.sourceImages?.find((i) => !i.fileDeleted);

  return (
    <figure className="shot" style={{ margin: 0, opacity: 0.55 }}>
      <div
        style={{
          position: 'relative',
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--surface-2)',
        }}
      >
        {sourceImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrlBase ? `${fileUrlBase}/${sourceImage.id}` : `/bff${sourceImage.fileUrl}`}
              alt={`Repeated screenshot at ${captureTimeLabel}`}
              style={{
                display: 'block',
                width: '100%',
                filter: blurred ? 'blur(14px)' : 'none',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(242,246,252,0.55)',
                fontSize: 11,
                fontWeight: 650,
                color: 'var(--text-muted)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}
            >
              Repeated
            </div>
          </>
        ) : (
          <div
            className="shot-gone"
            style={{ fontSize: 11, color: 'var(--text-faint)' }}
          >
            No capture — screen unchanged
          </div>
        )}
      </div>
      <figcaption className="cap">
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{captureTimeLabel}</span>
        <span className="faint" style={{ fontSize: 10 }}>repeated</span>
      </figcaption>
    </figure>
  );
});

// ---------------------------------------------------------------------------
// CaptureTile — memo so only the one revealed tile re-renders on setRevealed
// ---------------------------------------------------------------------------

const CaptureTile = memo(function CaptureTile({ group, timeFmt, revealed, onReveal, fileUrlBase, blurred }) {
  const available = group.images.filter((i) => !i.fileDeleted);
  const allPurged = available.length === 0;
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
    const timeStr = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return month && day ? `${month} ${day}, ${timeStr}` : timeStr;
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

/**
 * Walk the real capture groups in chronological order and insert phantom "repeat" tiles
 * wherever the gap to the next group exceeds `gapThresholdMs`.
 *
 * Each repeat tile carries a reference to the preceding real group's images so the UI can
 * render the same image dimmed, making it clear the screen state did not change.
 */
function fillGaps(groups, gapThresholdMs) {
  if (groups.length < 2) return groups;

  // Groups arrive newest-first from the API. Work in ascending order, then reverse at the end.
  const asc = [...groups].reverse();
  const result = [];

  for (let i = 0; i < asc.length; i += 1) {
    result.push(asc[i]);

    if (i + 1 < asc.length) {
      const thisTs = new Date(asc[i].capturedAt).getTime();
      const nextTs = new Date(asc[i + 1].capturedAt).getTime();
      const gap = nextTs - thisTs;

      if (gap > gapThresholdMs) {
        // How many repeat slots fit in the gap? Use the gap threshold as the slot width.
        const slots = Math.floor(gap / gapThresholdMs) - 1;
        const slotMs = gap / (slots + 1);

        for (let s = 1; s <= slots; s += 1) {
          const repeatTs = new Date(thisTs + s * slotMs).toISOString();
          result.push({
            id: `repeat-${asc[i].id}-${s}`,
            capturedAt: repeatTs,
            images: asc[i].images, // same images as the last real capture
            sourceImages: asc[i].images, // explicit ref for RepeatTile
            isRepeat: true,
          });
        }
      }
    }
  }

  // Restore newest-first order that the rest of the component expects.
  return result.reverse();
}
