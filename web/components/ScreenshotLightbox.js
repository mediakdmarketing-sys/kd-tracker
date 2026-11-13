'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A full-screen viewer for screenshots: next and previous capture with the arrow keys or buttons,
 * zoom to actual size, switch between a capture's screens, Esc to close.
 *
 * Privacy: an image is only fetched when it is on screen. The neighbours are NOT preloaded, because
 * every fetch of a screenshot file is recorded in the audit log as someone looking at it. Stepping to
 * the next capture is a deliberate look, so it is recorded; a silent preload would record looks that
 * never happened.
 *
 * @param {object} props
 * @param {Array<{id: string, label: string, images: Array<{id: string, url: string, label: string}>}>} props.slides
 *        newest first, as the grid shows them
 * @param {number} props.startIndex
 * @param {number} [props.startImage]  which screen of the first capture
 * @param {boolean} [props.blurred]    the person's screenshots are blurred until clicked
 * @param {string} [props.title]
 * @param {() => void} props.onClose
 */
export default function ScreenshotLightbox({ slides, startIndex, startImage = 0, blurred = false, title = '', onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [shot, setShot] = useState(startImage);
  const [zoomed, setZoomed] = useState(false);
  const [clear, setClear] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef(null);
  const scroller = useRef(null);

  const slide = slides[index];
  const image = slide?.images[Math.min(shot, (slide?.images.length || 1) - 1)];

  // Slides run newest first, so "later" is a smaller index.
  const go = useCallback(
    (delta) => {
      setIndex((i) => {
        const next = i + delta;
        return next < 0 || next >= slides.length ? i : next;
      });
      setShot(0);
      setZoomed(false);
      setFailed(false);
    },
    [slides.length]
  );
  const earlier = () => go(1);
  const later = () => go(-1);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(-1); }
      else if (event.key === '+' || event.key === '=' ) setZoomed(true);
      else if (event.key === '-' || event.key === '_') setZoomed(false);
      else if (event.key === 'Tab') {
        // Keep keyboard focus inside the dialog.
        const box = document.querySelector('.lightbox');
        const items = box ? [...box.querySelectorAll('button:not([disabled]), a[href]')] : [];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!slide || !image) return null;
  const stillBlurred = blurred && !clear;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Screenshot ${title ? `of ${title} ` : ''}at ${slide.label}`}>
      <div className="lightbox-backdrop" onClick={onClose} />

      <header className="lightbox-bar">
        <div className="lightbox-title">
          <strong>{title || 'Screenshot'}</strong>
          <span>{slide.label}</span>
          <span className="lightbox-count">{index + 1} of {slides.length}</span>
        </div>

        {slide.images.length > 1 && (
          <div className="lightbox-screens" role="tablist" aria-label="Screens">
            {slide.images.map((im, i) => (
              <button
                key={im.id}
                type="button"
                role="tab"
                aria-selected={i === shot}
                className={i === shot ? 'is-on' : ''}
                onClick={() => { setShot(i); setZoomed(false); setFailed(false); }}
              >
                {im.label}
              </button>
            ))}
          </div>
        )}

        <div className="lightbox-actions">
          <button type="button" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed} title="Actual size (+) or fit (−)">
            {zoomed ? 'Fit to screen' : 'Actual size'}
          </button>
          <a href={image.url} target="_blank" rel="noreferrer">Open in a tab</a>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <button type="button" className="lightbox-nav lightbox-prev" onClick={earlier} disabled={index >= slides.length - 1} aria-label="Earlier capture" title="Earlier (←)">
        ‹
      </button>
      <button type="button" className="lightbox-nav lightbox-next" onClick={later} disabled={index <= 0} aria-label="Later capture" title="Later (→)">
        ›
      </button>

      <div ref={scroller} className={`lightbox-stage${zoomed ? ' is-zoomed' : ''}`}>
        {failed ? (
          <div className="lightbox-fail">This screenshot could not be loaded. It may have been deleted under the retention rule.</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={image.id}
            src={image.url}
            alt={`${image.label} at ${slide.label}`}
            onClick={() => setZoomed((z) => !z)}
            onError={() => setFailed(true)}
            style={stillBlurred ? { filter: 'blur(18px)' } : undefined}
            draggable={false}
          />
        )}
        {stillBlurred && !failed && (
          <button type="button" className="lightbox-unblur" onClick={() => setClear(true)}>
            Blurred by default. Click to view clearly.
          </button>
        )}
      </div>

      <footer className="lightbox-foot">← earlier · → later · click the picture or press + to zoom · Esc to close. Each screenshot you view is recorded in the audit log.</footer>
    </div>
  );
}
