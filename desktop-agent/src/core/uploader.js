'use strict';

// Sprint 7, story G-4 — draining the outbox.
//
// The one rule: an item is only removed from the queue when the server has said it has it, or
// when retrying it can never succeed. Nothing is dropped because the network was bad.

const logger = require('./logger');

const DEFAULTS = {
  batchSize: 5,
  baseDelayMs: 5_000,
  maxDelayMs: 15 * 60_000,
  // Matches the server's MAX_CAPTURE_AGE_DAYS: past this it will refuse the item anyway.
  maxItemAgeMs: 7 * 24 * 60 * 60 * 1000,
};

/** Exponential backoff with jitter, so 60 agents reconnecting do not retry in lockstep. */
function backoffMs(attempts, { baseDelayMs, maxDelayMs }) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempts, 12));
  return Math.round(exponential * (0.7 + Math.random() * 0.6));
}

class Uploader {
  constructor({ outbox, api, options = {}, onStatus = () => {} }) {
    this.outbox = outbox;
    this.api = api;
    this.options = { ...DEFAULTS, ...options };
    this.onStatus = onStatus;
    this.timer = null;
    this.draining = false;
  }

  start(intervalMs = 15_000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.drain().catch((err) => logger.error('Drain failed', { message: err.message }));
    }, intervalMs);
    // Do not wait a full interval before the first attempt.
    this.drain().catch((err) => logger.error('Drain failed', { message: err.message }));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the due items. Safe to call concurrently; overlapping calls are ignored. */
  async drain(now = Date.now()) {
    if (this.draining) return { skipped: true };
    this.draining = true;

    try {
      const expired = this.outbox.expire({ maxAgeMs: this.options.maxItemAgeMs, now });
      if (expired) logger.warn('Dropped queue items older than the upload window', { count: expired });

      const items = this.outbox.due(this.options.batchSize, now);
      let sent = 0;
      let deferred = 0;
      let abandoned = 0;

      for (const item of items) {
        const outcome = await this.#sendOne(item, now);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'abandoned') abandoned += 1;
        else {
          deferred += 1;
          // A network failure or a rate limit applies to everything behind it too; stop the
          // pass rather than burning through the whole queue against a wall.
          if (outcome === 'stop') break;
        }
      }

      const stats = this.outbox.stats(now);
      this.onStatus({ ...stats, sent, deferred, abandoned });
      return { sent, deferred, abandoned, ...stats };
    } finally {
      this.draining = false;
    }
  }

  async #sendOne(item, now) {
    const payload = { ...item.payload };

    // Blobs live on disk; they are inlined only for the moment of sending.
    if (item.blob_field) {
      const blob = this.outbox.readBlob(item);
      if (!blob) {
        this.outbox.abandon(item.id, 'Spooled file is missing');
        logger.warn('Queue item lost its spooled file', { id: item.id, kind: item.kind });
        return 'abandoned';
      }
      payload[item.blob_field] = blob.toString('base64');
    }

    const res = await this.api.request(item.endpoint, { method: item.method, body: payload });
    return this.#classify(item, res, now);
  }

  /**
   * Deciding what a response means is the whole job. Getting this wrong either loses an
   * employee's work (dropping too eagerly) or wedges the queue forever (retrying a request the
   * server will never accept).
   */
  #classify(item, res, now) {
    const { baseDelayMs, maxDelayMs } = this.options;
    const defer = (error, delay) => {
      this.outbox.defer(item.id, {
        nextAttemptAt: now + (delay ?? backoffMs(item.attempts, { baseDelayMs, maxDelayMs })),
        error,
      });
    };

    // Offline / timeout. Not the item's fault; nothing behind it will fare better either.
    if (res.status === 0) {
      defer(res.networkError || 'network error');
      return 'stop';
    }

    if (res.status >= 200 && res.status < 300) {
      this.outbox.markSent(item.id);
      return 'sent';
    }

    if (res.status === 401) {
      // apiClient already tried to refresh. Sign-in is needed; hold everything.
      defer('not signed in', 60_000);
      this.onStatus({ ...this.outbox.stats(now), needsSignIn: true });
      return 'stop';
    }

    if (res.status === 429) {
      const delay = (res.retryAfterSeconds || 300) * 1000;
      defer('rate limited', delay);
      logger.warn('Rate limited; backing off', { seconds: delay / 1000 });
      return 'stop';
    }

    if (res.status === 409) {
      // What a 409 means depends entirely on what was sent, and treating both alike either
      // wedges the queue or silently deletes real work — see the note below.
      if (item.kind === 'punch') {
        // For a punch event, 409 almost always means the server already has it — the
        // response we lost was a success ("already have an open shift", "no open shift to
        // punch out of"). Retrying can never change that answer.
        this.outbox.markSent(item.id);
        logger.info('Server already had this punch event; dropping from queue', {
          message: res.body?.error?.message,
        });
        return 'sent';
      }

      // For a screenshot/audio/activity upload, the server returns 409 only when the
      // capture's own timestamp falls outside any shift or break window it can find
      // (capture.service.js's requireCapturableShift) — never as a duplicate-delivery
      // signal (a duplicate capture gets 201 + duplicate:true). That is a permanent
      // rejection: the timestamp will not change on retry. It is most likely to happen when
      // a queued punch-in got capped under the 4-hour backdating limit (ADR-0004) and the
      // server-recorded shift start ended up later than this capture. markSent() here would
      // delete evidence of real work with no trace at all; abandon it instead, so it stays
      // visible (status = abandoned, with the reason) rather than vanishing.
      this.outbox.abandon(item.id, res.body?.error?.message || 'Rejected: outside any capturable shift window');
      logger.warn('Capture rejected as outside a valid shift window; will not be retried', {
        kind: item.kind,
        message: res.body?.error?.message,
      });
      return 'abandoned';
    }

    if (res.status === 403) {
      if (res.body?.error?.code === 'ACCOUNT_DEACTIVATED') {
        // Distinct from a plain 403 (e.g. audio consent withdrawn, which rejects only that
        // one item): the whole account is dead, and every other queued item will fail the
        // same way for as long as it stays that way. The access token has not expired, so
        // this never goes through a 401/refresh cycle — it has to be caught here, or the
        // agent would sit there abandoning real captured work item by item while showing
        // the employee as signed in the whole time. Hold the item rather than abandoning it:
        // if HR reactivates the account, this is genuine work that should still be delivered.
        defer('account deactivated', 60_000);
        this.onStatus({ ...this.outbox.stats(now), needsSignIn: true });
        logger.warn('Account is deactivated; holding the queue and signalling sign-in is needed');
        return 'stop';
      }

      // Audio with consent withdrawn is the expected case, and must never be retried.
      this.outbox.abandon(item.id, res.body?.error?.message || 'Forbidden');
      logger.warn('Server refused an item permanently', {
        kind: item.kind,
        message: res.body?.error?.message,
      });
      return 'abandoned';
    }

    if (res.status >= 400 && res.status < 500) {
      // 400, 413 and friends: the payload itself is unacceptable. Retrying is pointless.
      this.outbox.abandon(item.id, res.body?.error?.message || `HTTP ${res.status}`);
      logger.warn('Server rejected an item', { kind: item.kind, status: res.status, message: res.body?.error?.message });
      return 'abandoned';
    }

    // 5xx — the server is having a bad time. Back off and keep the item.
    defer(`HTTP ${res.status}`);
    return 'stop';
  }
}

module.exports = { Uploader, backoffMs };
