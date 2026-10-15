'use strict';

const { tempOutbox, cleanup, fakeApi } = require('./helpers');
const { Agent } = require('../src/core/agent');
const { parseConnectLink, parseSyncLink } = require('../src/core/connectLink');

const CODE = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';

describe('parseConnectLink', () => {
  it('extracts the code from a connect link', () => {
    expect(parseConnectLink(`workbuddy://connect?code=${CODE}`)).toBe(CODE);
  });

  it('finds the link among a process argv, whatever else is in it', () => {
    const argv = ['C:\\app\\electron.exe', '.', `workbuddy://connect/?code=${CODE}`];
    expect(parseConnectLink(argv)).toBe(CODE);
  });

  it('is case-insensitive about the scheme, which Windows may normalise', () => {
    expect(parseConnectLink(`WorkBuddy://connect?code=${CODE}`)).toBe(CODE);
  });

  it.each([
    ['another scheme', `https://connect?code=${CODE}`],
    ['another action', `workbuddy://logout?code=${CODE}`],
    ['no code', 'workbuddy://connect'],
    ['a short code', 'workbuddy://connect?code=abc'],
    ['characters a code never has', `workbuddy://connect?code=${CODE}%00<script>`],
    ['not a string', undefined],
  ])('rejects %s', (_name, input) => {
    expect(parseConnectLink(input)).toBeNull();
  });
});

describe('parseSyncLink', () => {
  it('recognises the portal nudge, alone or inside an argv', () => {
    expect(parseSyncLink('workbuddy://sync')).toBe(true);
    expect(parseSyncLink(['electron.exe', '.', 'workbuddy://sync/'])).toBe(true);
  });

  it.each([
    ['a connect link', `workbuddy://connect?code=${CODE}`],
    ['another scheme', 'https://sync'],
    ['nothing', undefined],
    ['plain launch args', ['electron.exe', '.']],
  ])('does not mistake %s for it', (_name, input) => {
    expect(parseSyncLink(input)).toBe(false);
  });
});

describe('changes made on the web portal', () => {
  let outbox;
  beforeEach(async () => {
    outbox = await tempOutbox();
  });
  afterEach(() => {
    outbox.close();
    cleanup();
  });

  // Status answers come from a script the test advances, so "the server state changed" is explicit.
  function makeAgent() {
    const server = { state: 'punched_out' };
    const events = [];
    const api = fakeApi(({ path }) => {
      if (path === '/api/config') {
        return {
          status: 200,
          body: {
            screenshot: { minIntervalSeconds: 300, maxIntervalSeconds: 600 },
            audio: { enabled: false, sampleDurationSeconds: 300, sampleGapSeconds: 480 },
            shift: { targetSeconds: 32400, breakAllowanceSeconds: 3600, idleThresholdSeconds: 600 },
          },
        };
      }
      if (path.startsWith('/api/attendance/') && path !== '/api/attendance/status') {
        // The agent's own punch: the server applies it, then the follow-up status shows it.
        server.state = { 'punch-in': 'working', 'punch-out': 'punched_out', 'break-start': 'on_break', 'break-end': 'working' }[
          path.split('/').pop()
        ];
        return { status: 201, body: {} };
      }
      return {
        status: 200,
        body: { state: server.state, captureAllowed: server.state === 'working', audioAllowed: false },
      };
    });
    const agent = new Agent({
      api,
      outbox,
      uploader: { drain: async () => {}, stop() {} },
      capture: { screenshots: async () => [], audioSample: async () => null },
      onNotify: (event) => events.push(event),
    });
    return { agent, server, events };
  }

  const named = (events, ...names) => events.filter((e) => names.includes(e));

  it('says nothing on the very first sync, even if a shift is already running', async () => {
    const { agent, server, events } = makeAgent();
    server.state = 'working';

    await agent.syncStatus();

    expect(named(events, 'punchIn', 'punchOut', 'breakStart', 'breakEnd')).toEqual([]);
  });

  it('announces a punch-in made on the portal, so capture does not start silently', async () => {
    const { agent, server, events } = makeAgent();
    await agent.syncStatus();

    server.state = 'working';
    await agent.syncStatus();

    expect(named(events, 'punchIn')).toEqual(['punchIn']);
    expect(agent.state.captureAllowed).toBe(true);
  });

  it('announces break and punch-out made on the portal', async () => {
    const { agent, server, events } = makeAgent();
    server.state = 'working';
    await agent.syncStatus();

    server.state = 'on_break';
    await agent.syncStatus();
    server.state = 'working';
    await agent.syncStatus();
    server.state = 'punched_out';
    await agent.syncStatus();

    expect(named(events, 'breakStart', 'breakEnd', 'punchOut')).toEqual(['breakStart', 'breakEnd', 'punchOut']);
  });

  it('does not repeat itself when nothing changed', async () => {
    const { agent, server, events } = makeAgent();
    await agent.syncStatus();
    server.state = 'working';
    await agent.syncStatus();
    await agent.syncStatus();
    await agent.syncStatus();

    expect(named(events, 'punchIn')).toHaveLength(1);
  });

  it('announces a punch-in made through the agent once, not twice', async () => {
    const { agent, events } = makeAgent();
    await agent.syncStatus();

    await agent.punch('punchIn');

    expect(named(events, 'punchIn')).toHaveLength(1);
  });
});

describe('Agent.connect', () => {
  let outbox;
  beforeEach(async () => {
    outbox = await tempOutbox();
  });
  afterEach(() => {
    outbox.close();
    cleanup();
  });

  function makeAgent({ signedIn = false, employee = { id: 'e1', name: 'Karthik' }, fail } = {}) {
    const events = [];
    // Sign-in fetches config and status, which are different routes with different bodies.
    const api = fakeApi(({ path }) =>
      path === '/api/config'
        ? {
            status: 200,
            body: {
              screenshot: { minIntervalSeconds: 300, maxIntervalSeconds: 600 },
              audio: { enabled: false, sampleDurationSeconds: 300, sampleGapSeconds: 480 },
              shift: { targetSeconds: 32400, breakAllowanceSeconds: 3600, idleThresholdSeconds: 600 },
            },
          }
        : { status: 200, body: { state: 'punched_out', captureAllowed: false } }
    );
    api.isSignedIn = () => signedIn;
    api.connectWithCode = async (code) => {
      api.usedCode = code;
      if (fail) throw fail;
      return employee;
    };
    const agent = new Agent({
      api,
      outbox,
      uploader: { drain: async () => {}, stop() {} },
      capture: { screenshots: async () => [], audioSample: async () => null },
      onNotify: (event, data) => events.push([event, data]),
    });
    return { agent, api, events };
  }

  it('signs in with the code and tells the employee', async () => {
    const { agent, api, events } = makeAgent();

    const result = await agent.connect(CODE);

    expect(result).toMatchObject({ connected: true, employee: { name: 'Karthik' } });
    expect(api.usedCode).toBe(CODE);
    expect(agent.state.signedIn).toBe(true);
    expect(agent.state.employee.name).toBe('Karthik');
    expect(events).toContainEqual(['connected', 'Karthik']);
  });

  it('does not touch an agent that is already signed in', async () => {
    const { agent, api, events } = makeAgent({ signedIn: true });

    const result = await agent.connect(CODE);

    expect(result).toEqual({ connected: false, reason: 'already_signed_in' });
    expect(api.usedCode).toBeUndefined(); // the code was never even sent
    expect(events.find(([e]) => e === 'connected')).toBeUndefined();
  });

  it('stays signed out and reports the error when the code is refused', async () => {
    const { agent } = makeAgent({ fail: Object.assign(new Error('This connect link has expired.'), { status: 401 }) });

    await expect(agent.connect(CODE)).rejects.toThrow('expired');
    expect(agent.state.signedIn).toBe(false);
  });
});
