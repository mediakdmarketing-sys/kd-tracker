'use strict';

// Sprint 7, stories G-5 and G-6 — when to capture.
//
// Pure timing logic, kept out of the Electron layer so it can be tested with a fake clock
// instead of by watching a tray icon for ten minutes.

/**
 * Screenshots at a randomised interval (spec 6.2: 5–10 minutes).
 *
 * Randomised rather than fixed so the timing is not predictable — a fixed five-minute cadence
 * is trivially easy to work around, which would make the whole capture exercise theatre.
 */
class RandomIntervalScheduler {
  constructor({ minSeconds, maxSeconds, random = Math.random }) {
    this.minSeconds = minSeconds;
    this.maxSeconds = Math.max(maxSeconds, minSeconds);
    this.random = random;
    this.nextAt = null;
  }

  /** Called when capture becomes allowed (punch-in, or a break ending). */
  arm(now = Date.now()) {
    const span = this.maxSeconds - this.minSeconds;
    this.nextAt = now + (this.minSeconds + this.random() * span) * 1000;
    return this.nextAt;
  }

  disarm() {
    this.nextAt = null;
  }

  isDue(now = Date.now()) {
    return this.nextAt !== null && now >= this.nextAt;
  }

  secondsUntilNext(now = Date.now()) {
    return this.nextAt === null ? null : Math.max(0, Math.round((this.nextAt - now) / 1000));
  }
}

/**
 * Audio sampling (spec 6.3): record for a fixed window, then stay silent for a longer one.
 *
 * The gap is the point. Back-to-back samples would amount to continuous recording of an
 * employee's home, which is a different thing from periodic sampling both ethically and
 * legally — so the scheduler cannot produce overlapping windows even if it is driven wrongly.
 */
class SamplingScheduler {
  constructor({ durationSeconds, gapSeconds }) {
    this.durationSeconds = durationSeconds;
    this.gapSeconds = gapSeconds;
    this.recordingUntil = null;
    this.nextStartAt = null;
  }

  arm(now = Date.now()) {
    this.recordingUntil = null;
    // Start with a gap, so punching in does not immediately open the microphone.
    this.nextStartAt = now + this.gapSeconds * 1000;
  }

  /** Punch-in path: skip the initial gap and start the first sample right away. */
  armImmediate(now = Date.now()) {
    this.recordingUntil = null;
    this.nextStartAt = now;
  }

  disarm() {
    this.recordingUntil = null;
    this.nextStartAt = null;
  }

  isRecording(now = Date.now()) {
    return this.recordingUntil !== null && now < this.recordingUntil;
  }

  shouldStart(now = Date.now()) {
    return !this.isRecording(now) && this.nextStartAt !== null && now >= this.nextStartAt;
  }

  started(now = Date.now()) {
    this.recordingUntil = now + this.durationSeconds * 1000;
    // The next window is scheduled from the end of this one, never from its start — that is
    // what guarantees a real gap rather than overlapping samples.
    this.nextStartAt = this.recordingUntil + this.gapSeconds * 1000;
    return this.recordingUntil;
  }

  shouldStop(now = Date.now()) {
    return this.recordingUntil !== null && now >= this.recordingUntil;
  }

  stopped() {
    this.recordingUntil = null;
  }
}

module.exports = { RandomIntervalScheduler, SamplingScheduler };
