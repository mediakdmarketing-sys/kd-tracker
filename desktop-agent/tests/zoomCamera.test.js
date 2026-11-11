'use strict';

const { tempOutbox, cleanup, fakeApi } = require('./helpers');
const { Agent } = require('../src/core/agent');
const { createZoomWatcher, zoomCameraInUse, zoomInMeeting } = require('../src/main/zoomCamera');

let outbox;
beforeEach(async () => {
  outbox = await tempOutbox();
});
afterEach(() => {
  outbox.close();
  cleanup();
});

// --- Reading Windows ----------------------------------------------------------------------

const KEY = 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged';
const reg = (name, start, stop) =>
  `${KEY}\\${name}\r\n    Value    REG_SZ    Allow\r\n    LastUsedTimeStart    REG_QWORD    ${start}\r\n    LastUsedTimeStop    REG_QWORD    ${stop}\r\n`;

describe('reading the camera record', () => {
  it('says the camera is in use when Zoom started using it and has not stopped', () => {
    expect(zoomCameraInUse(reg('C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe', '0x1dbc3a2f4e5d6c7', '0x0'))).toBe(true);
  });

  it('says it is not in use once Zoom has stopped', () => {
    expect(zoomCameraInUse(reg('C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe', '0x1dbc3a2f4e5d6c7', '0x1dbc3a2ffffffff'))).toBe(false);
  });

  it('ignores other programs using the camera, and Zoom never having used it', () => {
    expect(zoomCameraInUse(reg('C:#Program Files#Teams#Teams.exe', '0x1dbc3a2f4e5d6c7', '0x0'))).toBe(false);
    expect(zoomCameraInUse(reg('C:#Zoom#Zoom.exe', '0x0', '0x0'))).toBe(false);
    expect(zoomCameraInUse('')).toBe(false);
  });

  it('finds Zoom among several programs', () => {
    const out = reg('C:#Other#app.exe', '0x1', '0x2') + reg('C:#Zoom#bin#Zoom.exe', '0x5', '0x0');
    expect(zoomCameraInUse(out)).toBe(true);
  });
});

describe('reading Zoom meetings', () => {
  it('sees a meeting from the window title, or from the meeting-only helper', () => {
    expect(zoomInMeeting('"Zoom.exe","123","Console","1","90,000 K","Running","PC\\a","0:00:10","Zoom Meeting"')).toBe(true);
    expect(zoomInMeeting('"Zoom.exe","123","Console","1","90,000 K","Running","PC\\a","0:00:10","Zoom Webinar"')).toBe(true);
    expect(zoomInMeeting('"CptHost.exe","456","Console","1","20,000 K","Running","PC\\a","0:00:01","N/A"')).toBe(true);
  });

  it('is not a meeting when only the Zoom window is open', () => {
    expect(zoomInMeeting('"Zoom.exe","123","Console","1","90,000 K","Running","PC\\a","0:00:10","Zoom Workplace"')).toBe(false);
    expect(zoomInMeeting('INFO: No tasks are running which match the specified criteria.')).toBe(false);
  });
});

describe('the watcher', () => {
  const exec = (answers) => async (file, args) => {
    if (file === 'reg') return answers.reg;
    return args.includes('IMAGENAME eq CptHost.exe') ? answers.helper || '' : answers.zoom || '';
  };

  it('does nothing off Windows', async () => {
    const check = createZoomWatcher({ platform: 'darwin', exec: async () => { throw new Error('should not run'); } });
    expect(await check()).toEqual({ supported: false, inMeeting: false, cameraOn: false });
  });

  it('reports a meeting with the camera off, and on', async () => {
    const zoom = '"Zoom.exe","1","Console","1","1 K","Running","u","0:00:01","Zoom Meeting"';
    const off = createZoomWatcher({ platform: 'win32', exec: exec({ zoom, reg: reg('C:#Zoom#Zoom.exe', '0x5', '0x9') }) });
    expect(await off()).toEqual({ supported: true, inMeeting: true, cameraOn: false });
    const on = createZoomWatcher({ platform: 'win32', exec: exec({ zoom, reg: reg('C:#Zoom#Zoom.exe', '0x5', '0x0') }) });
    expect(await on()).toEqual({ supported: true, inMeeting: true, cameraOn: true });
  });

  it('says it cannot tell, rather than guessing, when Windows will not answer', async () => {
    const check = createZoomWatcher({ platform: 'win32', exec: async () => { throw new Error('blocked'); } });
    expect((await check()).supported).toBe(false);
  });
});

// --- The rule -----------------------------------------------------------------------------

/** An agent on a punched-in shift whose Zoom check answers from `seen` and whose clock we move. */
async function inShift({ minutes = 5, shiftState = 'working' } = {}) {
  let clock = 1_000_000;
  let state = shiftState;
  let breaks = [];
  const seen = { supported: true, inMeeting: true, cameraOn: false };

  const api = fakeApi((req) => {
    if (req.path === '/api/attendance/break-start') {
      state = 'on_break';
      breaks = [{ start: 'x', end: null, reason: req.body?.reason || null }];
      return { status: 200, body: {} };
    }
    if (req.path === '/api/attendance/break-end') {
      state = 'working';
      breaks = [];
      return { status: 200, body: {} };
    }
    if (req.path === '/api/config') return { status: 200, body: { screenshot: { minIntervalSeconds: 300, maxIntervalSeconds: 600 }, audio: { sampleDurationSeconds: 60, sampleGapSeconds: 480 }, shift: { zoomCameraBreakMinutes: minutes } } };
    return { status: 200, body: { state, captureAllowed: state === 'working', audioAllowed: false, breakSeconds: 0, shift: { breaks } } };
  });
  const events = [];
  const agent = new Agent({
    api,
    outbox,
    uploader: { drain: async () => {}, stop() {} },
    capture: { screenshots: async () => [], audioSample: async () => null, meetingCheck: async () => ({ ...seen }) },
    onNotify: (event) => events.push(event),
    now: () => clock,
  });
  await agent.syncConfig();
  await agent.syncStatus();

  return {
    api,
    agent,
    seen,
    events,
    state: () => agent.state.shiftState,
    // One 15-second look at Zoom, repeated for `seconds`.
    wait: async (seconds) => {
      for (let t = 0; t < seconds; t += 15) {
        clock += 15_000;
        await agent.tick();
      }
    },
    breakStarts: () => api.calls.filter((c) => c.path === '/api/attendance/break-start'),
    breakEnds: () => api.calls.filter((c) => c.path === '/api/attendance/break-end'),
  };
}

describe('camera off in a Zoom meeting starts a break', () => {
  it('warns first, then starts a break with the reason once the minutes have passed', async () => {
    const s = await inShift({ minutes: 5 });
    await s.wait(60);
    expect(s.events).toContain('zoomCameraWarn');
    expect(s.state()).toBe('working');

    await s.wait(5 * 60);
    expect(s.state()).toBe('on_break');
    expect(s.breakStarts()).toHaveLength(1);
    expect(s.breakStarts()[0].body).toEqual({ reason: 'zoom_camera_off' });
    expect(s.events).toContain('zoomBreakStart');
  });

  it('does not start a break if the camera comes back on in time, and starts counting afresh', async () => {
    const s = await inShift({ minutes: 5 });
    await s.wait(3 * 60);
    s.seen.cameraOn = true;
    await s.wait(30);
    s.seen.cameraOn = false;
    await s.wait(3 * 60);
    expect(s.breakStarts()).toHaveLength(0);
    expect(s.state()).toBe('working');
  });

  it('ends its own break when the camera goes on', async () => {
    const s = await inShift({ minutes: 1 });
    await s.wait(2 * 60);
    expect(s.state()).toBe('on_break');

    s.seen.cameraOn = true;
    await s.wait(30);
    expect(s.state()).toBe('working');
    expect(s.breakEnds()).toHaveLength(1);
    expect(s.events).toContain('zoomBreakEnd');
  });

  it('ends its own break when the meeting ends', async () => {
    const s = await inShift({ minutes: 1 });
    await s.wait(2 * 60);
    s.seen.inMeeting = false;
    await s.wait(30);
    expect(s.state()).toBe('working');
  });

  it('does not start the break again if the person ended it while the camera is still off', async () => {
    const s = await inShift({ minutes: 1 });
    await s.wait(2 * 60);
    expect(s.state()).toBe('on_break');

    await s.agent.punch('breakEnd'); // the person ends it themselves
    expect(s.state()).toBe('working');
    await s.wait(5 * 60);
    expect(s.breakStarts()).toHaveLength(1); // still only the first one

    // A new meeting (camera on, then off again) starts the count afresh.
    s.seen.cameraOn = true;
    await s.wait(30);
    s.seen.cameraOn = false;
    await s.wait(2 * 60);
    expect(s.breakStarts()).toHaveLength(2);
  });

  it('leaves a break the person started alone', async () => {
    const s = await inShift({ minutes: 1, shiftState: 'on_break' });
    await s.wait(5 * 60);
    expect(s.breakStarts()).toHaveLength(0);
    s.seen.cameraOn = true;
    await s.wait(30);
    expect(s.breakEnds()).toHaveLength(0); // not ours to end
    expect(s.state()).toBe('on_break');
  });

  it('does nothing when HR has it switched off, or when Windows cannot say', async () => {
    const off = await inShift({ minutes: 0 });
    await off.wait(10 * 60);
    expect(off.breakStarts()).toHaveLength(0);

    const unknown = await inShift({ minutes: 1 });
    unknown.seen.supported = false;
    await unknown.wait(5 * 60);
    expect(unknown.breakStarts()).toHaveLength(0);
  });

  it('does nothing outside a meeting', async () => {
    const s = await inShift({ minutes: 1 });
    s.seen.inMeeting = false;
    await s.wait(5 * 60);
    expect(s.breakStarts()).toHaveLength(0);
    expect(s.events).not.toContain('zoomCameraWarn');
  });
});
