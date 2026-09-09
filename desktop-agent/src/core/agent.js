'use strict';

// The agent's brain. No Electron in here: screen, microphone and input access are injected,
// so the decision-making — when to capture, what to queue, what the tray should show — is
// testable with fakes.

const crypto = require('crypto');
const logger = require('./logger');
const { RandomIntervalScheduler, SamplingScheduler } = require('./scheduler');
const { DEFAULT_CAPTURE } = require('./settings');

const PUNCH_ENDPOINTS = {
  punchIn: '/api/attendance/punch-in',
  punchOut: '/api/attendance/punch-out',
  breakStart: '/api/attendance/break-start',
  breakEnd: '/api/attendance/break-end',
};

class Agent {
  /**
   * @param {object} deps
   * @param {import('./apiClient').ApiClient} deps.api
   * @param {object} deps.outbox
   * @param {object} deps.uploader
   * @param {object} deps.capture   { screenshots(), audioSample(seconds), activity() }
   * @param {Function} [deps.onState]
   * @param {Function} [deps.now]
   */
  constructor({ api, outbox, uploader, capture, onState = () => {}, onNotify = () => {}, now = () => Date.now(), random = Math.random }) {
    this.api = api;
    this.outbox = outbox;
    this.uploader = uploader;
    this.capture = capture;
    this.onState = onState;
    this.onNotify = onNotify;
    this.now = now;
    this.random = random;

    this.config = DEFAULT_CAPTURE;
    this.state = {
      signedIn: api.isSignedIn(),
      employee: null,
      shiftState: 'unknown', // unknown | punched_out | working | on_break
      captureAllowed: false,
      audioAllowed: false,
      online: true,
      queue: { pending: 0, abandoned: 0, oldestAgeSeconds: 0 },
      lastError: null,
    };

    this.screenshotScheduler = new RandomIntervalScheduler({
      minSeconds: this.config.screenshot.minIntervalSeconds,
      maxSeconds: this.config.screenshot.maxIntervalSeconds,
      random,
    });
    this.audioScheduler = new SamplingScheduler({
      durationSeconds: this.config.audio.sampleDurationSeconds,
      gapSeconds: this.config.audio.sampleGapSeconds,
    });
  }

  #emit(patch = {}) {
    this.state = { ...this.state, ...patch, queue: this.outbox.stats(this.now()) };
    this.onState(this.state);
    return this.state;
  }

  // Convenience: fire a notification event with optional data payload.
  #notify(event, data) {
    try { this.onNotify(event, data); } catch { /* never crash the agent */ }
  }

  async signIn(email, password) {
    const employee = await this.api.login(email, password);
    this.#emit({ signedIn: true, employee, lastError: null });
    await this.syncConfig();
    await this.syncStatus();
    return employee;
  }

  async signOut() {
    await this.api.logout();
    this.#stopCapture();
    this.#emit({ signedIn: false, employee: null, shiftState: 'unknown', lastError: null });
  }

  /**
   * The uploader calls this when the server has rejected requests with a 401 that a token
   * refresh could not fix — the session is dead (HR deactivated the account, a password was
   * reset, or ADR-0004's theft response revoked it). Without this, `state.signedIn` stays true
   * forever: the tray keeps showing the employee as working and nothing ever prompts them to
   * sign back in, so everything they do afterward queues and is never delivered.
   */
  markSignedOut(reason = 'Your session ended. Please sign in again.') {
    if (!this.state.signedIn) return;
    this.#stopCapture();
    this.#notify('sessionExpired');
    this.#emit({ signedIn: false, employee: null, shiftState: 'unknown', lastError: reason });
  }

  /**
   * Lets the uploader push a queue-depth update the moment a drain pass finishes, instead of
   * the tray and popup waiting for the next punch/status action to refresh (up to
   * STATUS_SYNC_MS later).
   */
  refreshQueueStats() {
    this.#emit();
  }

  /** Capture cadence is the server's decision, fetched on sign-in and on every status sync. */
  async syncConfig() {
    const res = await this.api.request('/api/config');
    if (res.status !== 200) return this.config;

    this.config = res.body;
    this.screenshotScheduler.minSeconds = res.body.screenshot.minIntervalSeconds;
    this.screenshotScheduler.maxSeconds = res.body.screenshot.maxIntervalSeconds;
    this.audioScheduler.durationSeconds = res.body.audio.sampleDurationSeconds;
    this.audioScheduler.gapSeconds = res.body.audio.sampleGapSeconds;
    return this.config;
  }

  async syncStatus() {
    const res = await this.api.request('/api/attendance/status');

    if (res.status === 0) {
      // Just went offline (was online before).
      if (this.state.online) this.#notify('offline');
      return this.#emit({ online: false });
    }
    if (res.status !== 200) return this.#emit({ online: true, lastError: res.body?.error?.message });

    const status = res.body;
    const shiftState = status.state === 'punched_out' ? 'punched_out' : status.state;
    const wasOffline = !this.state.online;
    const wasCapturing = this.state.captureAllowed;

    // The server decides whether capture is allowed. The agent never assumes it may capture.
    if (status.captureAllowed) this.#startCapture(status.audioAllowed);
    else this.#stopCapture();

    const nowCapturing = Boolean(status.captureAllowed);

    // Just came back online — let the employee know uploads are resuming.
    if (wasOffline) {
      this.#notify('backOnline', this.outbox.stats(this.now()).pending);
    }

    // Punch-in just happened (capture was off, now it is on): fire the first screenshot and
    // audio sample immediately instead of waiting for the scheduler interval (5–10 min).
    if (!wasCapturing && nowCapturing) {
      this.captureScreens().catch((err) =>
        logger.error('Immediate post-punch-in screenshot failed', { message: err.message })
      );
      if (status.audioAllowed) {
        this.audioScheduler.armImmediate(this.now());
      }
    }

    return this.#emit({
      online: true,
      shiftState,
      captureAllowed: nowCapturing,
      audioAllowed: Boolean(status.audioAllowed),
      status,
      lastError: null,
    });
  }

  #startCapture(audioAllowed) {
    if (this.screenshotScheduler.nextAt === null) this.screenshotScheduler.arm(this.now());
    if (audioAllowed) {
      if (this.audioScheduler.nextStartAt === null) this.audioScheduler.arm(this.now());
    } else {
      this.audioScheduler.disarm();
    }
  }

  #stopCapture() {
    this.screenshotScheduler.disarm();
    this.audioScheduler.disarm();
  }

  // --- Punch actions -------------------------------------------------------------------

  /**
   * Punch events go to the server first so the employee gets a real answer. If the network is
   * down they are queued with the time they happened, and the server honours that on delivery
   * (ADR-0004) — the employee is not penalised for their broadband.
   */
  async punch(action) {
    const endpoint = PUNCH_ENDPOINTS[action];
    if (!endpoint) throw new Error(`Unknown punch action: ${action}`);

    const at = new Date(this.now()).toISOString();
    const res = await this.api.request(endpoint, { method: 'POST', body: {} });

    if (res.status === 0) {
      this.outbox.enqueue({ kind: 'punch', endpoint, payload: { at }, at: this.now() });
      logger.warn('Offline: punch event queued', { action, at });
      this.#notify('offline');

      const optimistic = {
        punchIn: 'working',
        punchOut: 'punched_out',
        breakStart: 'on_break',
        breakEnd: 'working',
      }[action];

      if (optimistic === 'working') {
        this.#startCapture(this.state.audioAllowed);
        this.#notify('resetSession');
        if (action === 'punchIn') this.#notify('punchIn');
        if (action === 'breakEnd') this.#notify('breakEnd');
      } else {
        this.#stopCapture();
        if (action === 'punchOut') this.#notify('punchOut');
        if (action === 'breakStart') this.#notify('breakStart');
      }

      return this.#emit({ online: false, shiftState: optimistic, captureAllowed: optimistic === 'working' });
    }

    if (res.status >= 400) {
      return this.#emit({ online: true, lastError: res.body?.error?.message || `HTTP ${res.status}` });
    }

    // Fire the user-action notification immediately — syncStatus follows and may take a moment.
    if (action === 'punchIn')    { this.#notify('resetSession'); this.#notify('punchIn'); }
    if (action === 'punchOut')   this.#notify('punchOut');
    if (action === 'breakStart') this.#notify('breakStart');
    if (action === 'breakEnd')   this.#notify('breakEnd');

    return this.syncStatus();
  }

  // --- Capture -------------------------------------------------------------------------

  /**
   * Driven once a second by the main process. Cheap: it only looks at clocks unless something
   * is actually due.
   */
  async tick() {
    if (!this.state.signedIn) return;
    const now = this.now();

    if (this.state.captureAllowed && this.screenshotScheduler.isDue(now)) {
      this.screenshotScheduler.arm(now);
      await this.captureScreens().catch((err) =>
        logger.error('Screenshot capture failed', { message: err.message })
      );
    }

    if (this.state.audioAllowed) {
      if (this.audioScheduler.shouldStart(now)) {
        this.audioScheduler.started(now);
        await this.captureAudio().catch((err) =>
          logger.error('Audio capture failed', { message: err.message })
        );
      }
    }
  }

  /**
   * One capture moment, every display (ADR-0005). Each image is queued separately so a flaky
   * upload loses one screen rather than the whole moment, and they share a `captureGroupId`
   * so the portal shows them together.
   */
  async captureScreens() {
    const capturedAt = new Date(this.now()).toISOString();
    const images = await this.capture.screenshots();

    if (!images.length) {
      logger.warn('No displays returned by the capture layer; nothing queued');
      // Empty thumbnails mean screen recording permission is missing.
      this.#notify('screenMonitoringFailed');
      return 0;
    }

    // At least one real image came back — screen monitoring is working.
    this.#notify('screenMonitoringOk');
    // Full confirmation: both screen and (if applicable) audio are active.
    this.#notify('recordingActive');

    const captureGroupId = crypto.randomUUID();

    for (const image of images) {
      this.outbox.enqueue({
        kind: 'screenshot',
        endpoint: '/api/screenshots/upload',
        blob: image.buffer,
        blobField: 'imageBase64',
        captureId: crypto.randomUUID(),
        at: this.now(),
        payload: {
          captureGroupId,
          displayIndex: image.displayIndex,
          displayCount: images.length,
          displayLabel: image.label,
          contentType: image.contentType || 'image/jpeg',
          capturedAt,
        },
      });
    }

    this.#emit();
    return images.length;
  }

  async captureAudio() {
    const durationSeconds = this.config.audio.sampleDurationSeconds;
    const recordedAt = new Date(this.now()).toISOString();
    const sample = await this.capture.audioSample(durationSeconds);

    if (!sample) {
      // recordSample() returned null — permission denied or recorder window timed out.
      this.#notify('audioDisabled');
      return false;
    }

    // micMuted === true means the renderer detected silence for the whole sample.
    if (sample.micMuted === true) {
      this.#notify('micMuted');
    }

    this.outbox.enqueue({
      kind: 'audio',
      endpoint: '/api/audio/upload',
      blob: sample.buffer,
      blobField: 'audioBase64',
      captureId: crypto.randomUUID(),
      at: this.now(),
      payload: {
        durationSeconds: sample.durationSeconds || durationSeconds,
        contentType: sample.contentType || 'audio/webm',
        recordedAt,
        // null means the renderer could not determine (old build or permission error).
        // The server stores null, false, or true — never an assumed value.
        ...(sample.micMuted !== undefined && { micMuted: sample.micMuted }),
      },
    });

    this.audioScheduler.stopped();
    this.#emit();
    return true;
  }

  /** Activity counters, sampled on a fixed interval by the main process. */
  recordActivity(sample) {
    this.outbox.enqueue({
      kind: 'activity',
      endpoint: '/api/activity/log',
      captureId: crypto.randomUUID(),
      at: this.now(),
      payload: {
        keystrokeCount: sample.keystrokeCount,
        mouseCount: sample.mouseCount,
        windowTitle: sample.windowTitle,
        timestamp: new Date(this.now()).toISOString(),
      },
    });
    this.#emit();
  }
}

module.exports = { Agent, PUNCH_ENDPOINTS };
