'use strict';

const { tempOutbox, cleanup, fakeApi, OFFLINE } = require('./helpers');
const { Agent } = require('../src/core/agent');

let outbox;

beforeEach(async () => {
  outbox = await tempOutbox();
});
afterEach(() => {
  outbox.close();
  cleanup();
});

function statusResponse(overrides = {}) {
  return {
    status: 200,
    body: {
      state: 'working',
      captureAllowed: true,
      audioAllowed: false,
      workedSeconds: 3600,
      breakSeconds: 0,
      ...overrides,
    },
  };
}

function makeAgent({ api, capture = {}, now = () => 1_000_000 } = {}) {
  return new Agent({
    api,
    outbox,
    uploader: { drain: async () => {}, stop() {} },
    capture: {
      screenshots: capture.screenshots || (async () => []),
      audioSample: capture.audioSample || (async () => null),
    },
    now,
  });
}

describe('capture gating', () => {
  it('arms capture only when the server says it is allowed', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse()) });
    await agent.syncStatus();

    expect(agent.state.captureAllowed).toBe(true);
    expect(agent.screenshotScheduler.nextAt).not.toBeNull();
  });

  it('disarms everything on a break', async () => {
    const agent = makeAgent({
      api: fakeApi(statusResponse({ state: 'on_break', captureAllowed: false, audioAllowed: false })),
    });
    await agent.syncStatus();

    expect(agent.state.captureAllowed).toBe(false);
    expect(agent.screenshotScheduler.nextAt).toBeNull();
    expect(agent.audioScheduler.nextStartAt).toBeNull();
  });

  it('does not arm audio without server-side consent', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse({ audioAllowed: false })) });
    await agent.syncStatus();

    expect(agent.audioScheduler.nextStartAt).toBeNull();
  });

  it('arms audio when consent is in place', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse({ audioAllowed: true })) });
    await agent.syncStatus();

    expect(agent.audioScheduler.nextStartAt).not.toBeNull();
  });

  it('captures nothing while punched out, even if the clock says a capture is due', async () => {
    let captured = 0;
    const agent = makeAgent({
      api: fakeApi(statusResponse({ state: 'punched_out', captureAllowed: false })),
      capture: {
        screenshots: async () => {
          captured += 1;
          return [{ buffer: Buffer.from('x'), displayIndex: 0, label: 'D' }];
        },
      },
    });

    await agent.syncStatus();
    await agent.tick();

    expect(captured).toBe(0);
    expect(outbox.stats().pending).toBe(0);
  });
});

describe('multi-display capture', () => {
  it('queues one item per display, sharing a capture group', async () => {
    const agent = makeAgent({
      api: fakeApi(statusResponse()),
      capture: {
        screenshots: async () => [
          { buffer: Buffer.from('primary'), displayIndex: 0, label: 'Built-in' },
          { buffer: Buffer.from('second'), displayIndex: 1, label: 'DELL U2720Q' },
        ],
      },
    });

    await agent.syncStatus();
    await agent.captureScreens();

    const items = outbox.due(10, 2_000_000);
    expect(items).toHaveLength(2);

    const groups = new Set(items.map((i) => i.payload.captureGroupId));
    expect(groups.size).toBe(1);
    expect(items.map((i) => i.payload.displayIndex)).toEqual([0, 1]);
    expect(items.every((i) => i.payload.displayCount === 2)).toBe(true);
    // Each image gets its own replay key, or the second would be treated as a duplicate.
    expect(new Set(items.map((i) => i.capture_id)).size).toBe(2);
    expect(items[1].payload.displayLabel).toBe('DELL U2720Q');
  });

  it('shares one capturedAt across the group', async () => {
    const agent = makeAgent({
      api: fakeApi(statusResponse()),
      capture: {
        screenshots: async () => [
          { buffer: Buffer.from('a'), displayIndex: 0, label: 'A' },
          { buffer: Buffer.from('b'), displayIndex: 1, label: 'B' },
        ],
      },
    });

    await agent.syncStatus();
    await agent.captureScreens();

    const times = outbox.due(10, 2_000_000).map((i) => i.payload.capturedAt);
    expect(new Set(times).size).toBe(1);
  });
});

describe('punch events', () => {
  it('queues a punch with its real time when the network is down', async () => {
    const agent = makeAgent({ api: fakeApi(OFFLINE), now: () => 1_700_000_000_000 });

    await agent.punch('punchIn');

    const [item] = outbox.due(10, 1_700_000_001_000);
    expect(item.endpoint).toBe('/api/attendance/punch-in');
    // ADR-0004: the server honours this, so a bad connection does not cost the employee time.
    expect(item.payload.at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('shows the employee the state they just chose, offline or not', async () => {
    const agent = makeAgent({ api: fakeApi(OFFLINE) });

    await agent.punch('punchIn');
    expect(agent.state.shiftState).toBe('working');
    expect(agent.state.online).toBe(false);

    await agent.punch('punchOut');
    expect(agent.state.shiftState).toBe('punched_out');
    expect(agent.state.captureAllowed).toBe(false);
  });

  it('stops capturing the moment a break starts, without waiting for the server', async () => {
    const agent = makeAgent({ api: fakeApi(OFFLINE) });

    await agent.punch('punchIn');
    expect(agent.screenshotScheduler.nextAt).not.toBeNull();

    await agent.punch('breakStart');
    expect(agent.screenshotScheduler.nextAt).toBeNull();
  });

  it('does not queue anything when the server answers', async () => {
    const agent = makeAgent({
      api: fakeApi([{ status: 201, body: {} }, statusResponse()]),
    });

    await agent.punch('punchIn');

    expect(outbox.stats().pending).toBe(0);
    expect(agent.state.shiftState).toBe('working');
  });

  it('surfaces a server refusal instead of pretending it worked', async () => {
    const agent = makeAgent({
      api: fakeApi({ status: 403, body: { error: { message: 'Consent required' } } }),
    });

    await agent.punch('punchIn');

    expect(agent.state.lastError).toBe('Consent required');
    expect(agent.state.shiftState).not.toBe('working');
  });
});

// The bug this guards against: a session killed server-side (HR deactivation, a password
// reset, an ADR-0004 theft response) used to leave `state.signedIn` stuck at `true` forever,
// since nothing ever called back into the agent to say the session had died.
describe('session death', () => {
  it('demotes signedIn and stops capturing when the uploader reports the session is dead', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse()) });
    await agent.syncStatus();
    expect(agent.state.captureAllowed).toBe(true);

    agent.markSignedOut();

    expect(agent.state.signedIn).toBe(false);
    expect(agent.state.employee).toBeNull();
    expect(agent.state.lastError).toMatch(/sign in/i);
    expect(agent.screenshotScheduler.nextAt).toBeNull();
  });

  it('does nothing if the session was already ended', async () => {
    const seen = [];
    const agent = makeAgent({ api: fakeApi(statusResponse()) });
    agent.onState = (s) => seen.push(s);

    agent.markSignedOut();
    const afterFirst = seen.length;
    agent.markSignedOut();

    expect(seen.length).toBe(afterFirst);
  });

  it('lets the uploader push a queue update without waiting for the next status sync', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse()) });
    outbox.enqueue({ kind: 'activity', endpoint: '/x', payload: {} });

    agent.refreshQueueStats();

    expect(agent.state.queue.pending).toBe(1);
  });
});

describe('activity', () => {
  it('queues counts and a timestamp, and nothing that could hold content', async () => {
    const agent = makeAgent({ api: fakeApi(statusResponse()), now: () => 1_700_000_000_000 });

    agent.recordActivity({ keystrokeCount: 42, mouseCount: 7, windowTitle: 'VS Code' });

    const [item] = outbox.due(10, 1_700_000_001_000);
    expect(item.payload).toEqual({
      keystrokeCount: 42,
      mouseCount: 7,
      windowTitle: 'VS Code',
      timestamp: new Date(1_700_000_000_000).toISOString(),
      captureId: item.capture_id,
    });
  });
});
