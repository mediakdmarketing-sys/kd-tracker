'use strict';

const { RandomIntervalScheduler, SamplingScheduler } = require('../src/core/scheduler');

describe('screenshot scheduling', () => {
  it('lands inside the configured window', () => {
    const now = 1_000_000;
    for (const r of [0, 0.5, 0.999]) {
      const s = new RandomIntervalScheduler({ minSeconds: 300, maxSeconds: 600, random: () => r });
      const next = s.arm(now);
      expect(next).toBeGreaterThanOrEqual(now + 300_000);
      expect(next).toBeLessThanOrEqual(now + 600_000);
    }
  });

  it('varies between captures, so the timing is not predictable', () => {
    const s = new RandomIntervalScheduler({ minSeconds: 300, maxSeconds: 600 });
    const values = new Set(Array.from({ length: 20 }, () => s.arm(0)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('is not due before its time and is due after', () => {
    const s = new RandomIntervalScheduler({ minSeconds: 300, maxSeconds: 300, random: () => 0 });
    s.arm(0);

    expect(s.isDue(299_000)).toBe(false);
    expect(s.isDue(300_000)).toBe(true);
  });

  it('is never due once disarmed — nothing is captured off shift', () => {
    const s = new RandomIntervalScheduler({ minSeconds: 1, maxSeconds: 1 });
    s.arm(0);
    s.disarm();

    expect(s.isDue(1e12)).toBe(false);
  });
});

describe('audio sampling', () => {
  const config = { durationSeconds: 300, gapSeconds: 480 };

  it('waits a full gap before the first sample, so punching in does not open the mic', () => {
    const s = new SamplingScheduler(config);
    s.arm(0);

    expect(s.shouldStart(0)).toBe(false);
    expect(s.shouldStart(479_000)).toBe(false);
    expect(s.shouldStart(480_000)).toBe(true);
  });

  it('records for the configured duration and then stops', () => {
    const s = new SamplingScheduler(config);
    s.arm(0);
    s.started(480_000);

    expect(s.isRecording(600_000)).toBe(true);
    expect(s.shouldStop(600_000)).toBe(false);
    expect(s.shouldStop(780_000)).toBe(true);
  });

  // The gap is what makes this sampling rather than continuous surveillance, so it is
  // measured from the end of a sample and never from its start.
  it('leaves a real gap between samples', () => {
    const s = new SamplingScheduler(config);
    s.arm(0);

    const firstStart = 480_000;
    const firstEnd = s.started(firstStart);
    expect(firstEnd).toBe(firstStart + 300_000);

    expect(s.shouldStart(firstEnd + 479_000)).toBe(false);
    expect(s.shouldStart(firstEnd + 480_000)).toBe(true);
  });

  it('cannot be made to overlap two recordings', () => {
    const s = new SamplingScheduler(config);
    s.arm(0);
    s.started(480_000);

    // Even asked repeatedly while a sample is running, it refuses to start another.
    for (let t = 480_000; t < 780_000; t += 10_000) {
      expect(s.shouldStart(t)).toBe(false);
    }
  });

  it('stops entirely when disarmed', () => {
    const s = new SamplingScheduler(config);
    s.arm(0);
    s.disarm();

    expect(s.shouldStart(1e12)).toBe(false);
    expect(s.isRecording(1e12)).toBe(false);
  });
});
