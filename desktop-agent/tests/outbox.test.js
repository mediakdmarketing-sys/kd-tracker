'use strict';

const fs = require('fs');
const { Outbox } = require('../src/core/outbox');
const { tempOutbox, cleanup } = require('./helpers');

let outbox;

beforeEach(async () => {
  outbox = await tempOutbox();
});
afterEach(() => {
  outbox.close();
  cleanup();
});

describe('outbox', () => {
  it('holds an item until it is acknowledged', () => {
    outbox.enqueue({ kind: 'activity', endpoint: '/api/activity/log', payload: { keystrokeCount: 3 } });

    expect(outbox.stats().pending).toBe(1);
    expect(outbox.due()).toHaveLength(1);
  });

  it('drains oldest first, so a punch-in is delivered before its punch-out', () => {
    const first = outbox.enqueue({ kind: 'punch', endpoint: '/in', payload: {}, at: 1000 });
    const second = outbox.enqueue({ kind: 'punch', endpoint: '/out', payload: {}, at: 2000 });

    const due = outbox.due(10, 3000);
    expect(due.map((d) => d.id)).toEqual([first, second]);
  });

  it('copies the captureId into the payload so a retry sends the same one', () => {
    outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/api/screenshot/upload',
      payload: { displayIndex: 0 },
      captureId: 'abc-123',
    });

    const [item] = outbox.due();
    expect(item.payload.captureId).toBe('abc-123');
    expect(item.capture_id).toBe('abc-123');
  });

  it('spools a blob to disk rather than keeping it in the row', () => {
    const blob = Buffer.from('a screenshot');
    outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/api/screenshot/upload',
      payload: {},
      blob,
      blobField: 'imageBase64',
    });

    const [item] = outbox.due();
    expect(item.payload.imageBase64).toBeUndefined();
    expect(fs.existsSync(item.blob_path)).toBe(true);
    expect(outbox.readBlob(item).toString()).toBe('a screenshot');
  });

  it('deletes the spooled file once the item is sent', () => {
    const id = outbox.enqueue({
      kind: 'screenshot',
      endpoint: '/x',
      payload: {},
      blob: Buffer.from('bytes'),
      blobField: 'imageBase64',
    });
    const [item] = outbox.due();

    outbox.markSent(id);

    expect(fs.existsSync(item.blob_path)).toBe(false);
    expect(outbox.stats().pending).toBe(0);
  });

  it('holds a deferred item back until its retry time', () => {
    const id = outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: {}, at: 1000 });
    outbox.defer(id, { nextAttemptAt: 5000, error: 'offline' });

    expect(outbox.due(10, 4000)).toHaveLength(0);
    expect(outbox.due(10, 5000)).toHaveLength(1);
    expect(outbox.due(10, 5000)[0].attempts).toBe(1);
  });

  it('keeps an abandoned item visible but never retries it', () => {
    const id = outbox.enqueue({ kind: 'audio', endpoint: '/x', payload: {}, blob: Buffer.from('a'), blobField: 'audioBase64' });
    outbox.abandon(id, 'consent withdrawn');

    expect(outbox.due(10, Date.now() + 1e6)).toHaveLength(0);
    const stats = outbox.stats();
    expect(stats.pending).toBe(0);
    expect(stats.abandoned).toBe(1);
  });

  it('drops captures that have aged past the server upload window', () => {
    const now = Date.now();
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {}, at: now - 30 * 86400000 });
    outbox.enqueue({ kind: 'screenshot', endpoint: '/x', payload: {}, at: now - 60000 });

    const dropped = outbox.expire({ maxAgeMs: 7 * 86400000, now });

    expect(dropped).toBe(1);
    expect(outbox.stats(now).pending).toBe(1);
  });

  it('never drops a queued punch event for age', () => {
    const now = Date.now();
    outbox.enqueue({ kind: 'punch', endpoint: '/in', payload: {}, at: now - 30 * 86400000 });

    // Attendance is the employee's pay. It is escalated, never silently discarded.
    expect(outbox.expire({ maxAgeMs: 7 * 86400000, now })).toBe(0);
    expect(outbox.stats(now).pending).toBe(1);
  });

  it('survives being reopened, which is the point of it being on disk', async () => {
    outbox.enqueue({ kind: 'punch', endpoint: '/in', payload: { at: 'yesterday' } });
    const dir = outbox.dir;
    outbox.close();

    const reopened = await Outbox.open(dir);
    expect(reopened.due()).toHaveLength(1);
    expect(reopened.due()[0].payload.at).toBe('yesterday');
    reopened.close();

    outbox = await Outbox.open(dir); // so afterEach can close something valid
  });
});
