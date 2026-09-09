'use strict';

const { tempOutbox, cleanup, fakeApi, OK, OFFLINE } = require('./helpers');
const { Uploader, backoffMs } = require('../src/core/uploader');

let outbox;

beforeEach(async () => {
  outbox = await tempOutbox();
});
afterEach(() => {
  outbox.close();
  cleanup();
});

function makeUploader(script, options = {}) {
  const api = fakeApi(script);
  return { api, uploader: new Uploader({ outbox, api, options }) };
}

describe('uploader outcomes', () => {
  it('removes an item the server accepted', async () => {
    const { uploader } = makeUploader(OK);
    outbox.enqueue({ kind: 'activity', endpoint: '/api/activity/log', payload: { keystrokeCount: 1 } });

    const result = await uploader.drain();

    expect(result.sent).toBe(1);
    expect(outbox.stats().pending).toBe(0);
  });

  // The rule the whole queue exists for.
  it('keeps an item when the network is down', async () => {
    const { uploader } = makeUploader(OFFLINE);
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {} });

    await uploader.drain();

    expect(outbox.stats().pending).toBe(1);
  });

  it('stops the pass on the first network failure instead of hammering the wall', async () => {
    const { api, uploader } = makeUploader(OFFLINE);
    for (let i = 0; i < 5; i += 1) outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: { i } });

    await uploader.drain();

    expect(api.calls).toHaveLength(1);
    expect(outbox.stats().pending).toBe(5);
  });

  it('delivers everything once the connection comes back', async () => {
    let online = false;
    const { uploader } = makeUploader(() => (online ? OK : OFFLINE));
    for (let i = 0; i < 3; i += 1) outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: { i } });

    await uploader.drain();
    expect(outbox.stats().pending).toBe(3);

    online = true;
    // Deferred items are due immediately in this test because backoff is measured from `now`.
    await uploader.drain(Date.now() + 60_000);

    expect(outbox.stats().pending).toBe(0);
  });

  it('treats 409 on a punch event as delivered — the server already has it', async () => {
    const { uploader } = makeUploader({
      status: 409,
      body: { error: { message: 'You already have an open shift.' } },
    });
    outbox.enqueue({ kind: 'punch', endpoint: '/api/attendance/punch-in', payload: {} });

    const result = await uploader.drain();

    expect(result.sent).toBe(1);
    expect(outbox.stats().pending).toBe(0);
    expect(outbox.stats().abandoned).toBe(0);
  });

  // A 409 on a capture is never a duplicate-delivery signal (a repeated captureId gets 201 +
  // duplicate:true) — it means the timestamp falls outside any shift/break the server can
  // find, most often because a queued punch-in got capped under the 4h backdating limit
  // (ADR-0004) and the recorded shift start moved later than this capture. Retrying can never
  // fix that, but silently deleting it — the old behaviour — throws away real evidence with
  // no trace. It has to be abandoned (kept, marked, visible), not marked sent.
  it('abandons a screenshot rejected with 409, rather than silently deleting it', async () => {
    const { uploader } = makeUploader({
      status: 409,
      body: { error: { message: 'Capture is only accepted for time that falls inside a shift.' } },
    });
    outbox.enqueue({ kind: 'screenshot', endpoint: '/api/screenshot/upload', payload: {} });

    const result = await uploader.drain();

    expect(result.sent).toBe(0);
    expect(outbox.stats().abandoned).toBe(1);
    expect(outbox.stats().pending).toBe(0);
  });

  it('abandons an audio upload rejected with 409 the same way', async () => {
    const { uploader } = makeUploader({
      status: 409,
      body: { error: { message: 'Capture is not accepted during a break.' } },
    });
    outbox.enqueue({ kind: 'audio', endpoint: '/api/audio/upload', payload: {} });

    await uploader.drain();

    expect(outbox.stats().abandoned).toBe(1);
  });

  // The access token itself may not be expired yet when an account is deactivated (the row
  // check runs on every request, independent of JWT expiry — backend middleware/auth.js), so
  // this arrives as a 403 with a distinct code, never as a 401. It must be treated as an
  // account-wide signal, not abandoned as if this one item were the problem.
  it('holds the queue and signals needsSignIn on ACCOUNT_DEACTIVATED, without abandoning the item', async () => {
    const { uploader } = makeUploader({
      status: 403,
      body: { error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated' } },
    });
    const statuses = [];
    uploader.onStatus = (s) => statuses.push(s);
    outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: {} });

    await uploader.drain();

    expect(statuses.some((s) => s.needsSignIn)).toBe(true);
    expect(outbox.stats().pending).toBe(1);
    expect(outbox.stats().abandoned).toBe(0);
  });

  it('still abandons an ordinary 403 — e.g. audio consent withdrawn — with no such code', async () => {
    const { uploader } = makeUploader({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'Audio consent has not been given' } },
    });
    const statuses = [];
    uploader.onStatus = (s) => statuses.push(s);
    outbox.enqueue({ kind: 'audio', endpoint: '/api/audio/upload', payload: {} });

    await uploader.drain();

    expect(statuses.some((s) => s.needsSignIn)).toBe(false);
    expect(outbox.stats().abandoned).toBe(1);
  });

  it('surfaces needsSignIn through onStatus when a 401 cannot be recovered', async () => {
    const { uploader } = makeUploader({ status: 401, body: { error: { message: 'Invalid token' } } });
    const statuses = [];
    uploader.onStatus = (s) => statuses.push(s);
    outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: {} });

    await uploader.drain();

    expect(statuses.some((s) => s.needsSignIn)).toBe(true);
    // Held, not lost — the item is retried automatically once the employee signs back in.
    expect(outbox.stats().pending).toBe(1);
  });

  it('abandons audio the server refuses on consent, and never retries it', async () => {
    const { api, uploader } = makeUploader({
      status: 403,
      body: { error: { message: 'Audio consent has not been given' } },
    });
    outbox.enqueue({ kind: 'audio', endpoint: '/api/audio/upload', payload: {} });

    await uploader.drain();
    await uploader.drain(Date.now() + 3600_000);

    expect(api.calls).toHaveLength(1);
    expect(outbox.stats().abandoned).toBe(1);
    expect(outbox.stats().pending).toBe(0);
  });

  it('abandons a payload the server will never accept', async () => {
    const { uploader } = makeUploader({ status: 413, body: { error: { message: 'Too large' } } });
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {} });

    await uploader.drain();

    expect(outbox.stats().abandoned).toBe(1);
  });

  it('keeps the item and waits when the server is broken', async () => {
    const { uploader } = makeUploader({ status: 500, body: null });
    outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: {} });

    await uploader.drain();

    expect(outbox.stats().pending).toBe(1);
  });

  it('honours Retry-After on a rate limit and stops the pass', async () => {
    const { api, uploader } = makeUploader({ status: 429, body: null, retryAfterSeconds: 120 });
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {}, at: 1000 });
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {}, at: 1001 });

    await uploader.drain(2000);

    expect(api.calls).toHaveLength(1);
    // Nothing retried before the window the server asked for.
    expect(outbox.due(10, 2000 + 119_000)).toHaveLength(1);
    expect(outbox.due(10, 2000 + 121_000)).toHaveLength(2);
  });

  it('sends a spooled blob as base64 in the field the item names', async () => {
    const { api, uploader } = makeUploader(OK);
    outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/api/screenshot/upload',
      payload: { displayIndex: 0 },
      blob: Buffer.from('image bytes'),
      blobField: 'imageBase64',
      captureId: 'cap-1',
    });

    await uploader.drain();

    expect(api.calls[0].body.imageBase64).toBe(Buffer.from('image bytes').toString('base64'));
    expect(api.calls[0].body.captureId).toBe('cap-1');
  });

  it('abandons an item whose spooled file has vanished', async () => {
    const { uploader } = makeUploader(OK);
    outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/x',
      payload: {},
      blob: Buffer.from('bytes'),
      blobField: 'imageBase64',
    });
    const [item] = outbox.due();
    require('fs').unlinkSync(item.blob_path);

    await uploader.drain();

    expect(outbox.stats().abandoned).toBe(1);
  });

  it('retries with the same captureId every time, so the server can recognise the replay', async () => {
    let attempts = 0;
    const { api, uploader } = makeUploader(() => {
      attempts += 1;
      return attempts === 1 ? OFFLINE : OK;
    });

    outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/x',
      payload: {},
      blob: Buffer.from('x'),
      blobField: 'imageBase64',
      captureId: 'stable-id',
    });

    await uploader.drain();
    await uploader.drain(Date.now() + 120_000);

    expect(api.calls).toHaveLength(2);
    expect(api.calls[0].body.captureId).toBe('stable-id');
    expect(api.calls[1].body.captureId).toBe('stable-id');
  });
});

describe('backoff', () => {
  it('grows with each attempt and is capped', () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 60_000 };
    const first = backoffMs(0, options);
    const later = backoffMs(6, options);

    expect(first).toBeLessThan(later);
    expect(backoffMs(50, options)).toBeLessThanOrEqual(60_000 * 1.3);
  });

  it('is jittered, so reconnecting agents do not retry in lockstep', () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 60_000 };
    const values = new Set(Array.from({ length: 20 }, () => backoffMs(3, options)));
    expect(values.size).toBeGreaterThan(1);
  });
});
