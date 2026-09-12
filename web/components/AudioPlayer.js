'use client';

import { useRef } from 'react';

/**
 * Wraps a plain <audio> element with the standard fix for Chromium's WebM duration bug.
 *
 * The desktop agent records with MediaRecorder (audio/webm;codecs=opus) — see
 * desktop-agent/src/renderer/recorder.html. MediaRecorder writes WebM without a Segment
 * Duration in the container header (it cannot know the final length while still recording),
 * so Chromium-based browsers report `duration` as `Infinity` (or occasionally `NaN`) until
 * something forces a full scan of the file. Left alone this shows a wrong/blank time and the
 * progress bar never advances in proportion to playback.
 *
 * The fix (widely used, e.g. https://stackoverflow.com/q/39831822): seek to a huge
 * out-of-range time once metadata loads. The browser clamps the seek to the real end of the
 * file, which forces it to compute the true duration; that fires `durationchange` with the
 * correct value, and we immediately seek back to 0 so playback still starts from the top.
 */
export default function AudioPlayer({ src, style }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);

  const handleLoadedMetadata = (e) => {
    const audio = e.currentTarget;
    fixedRef.current = false;
    if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
      audio.currentTime = 1e101;
    }
  };

  const handleDurationChange = (e) => {
    const audio = e.currentTarget;
    if (!fixedRef.current && audio.currentTime === Infinity) {
      // Chromium reports currentTime as Infinity mid-scan; wait for the real value.
      return;
    }
    if (!fixedRef.current) {
      fixedRef.current = true;
      audio.currentTime = 0;
    }
  };

  return (
    <audio
      ref={ref}
      controls
      preload="metadata"
      src={src}
      style={style}
      onLoadedMetadata={handleLoadedMetadata}
      onDurationChange={handleDurationChange}
    />
  );
}
