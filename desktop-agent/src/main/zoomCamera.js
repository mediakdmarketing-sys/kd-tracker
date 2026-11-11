'use strict';

// Windows only: is this person in a Zoom meeting, and is their camera on in it?
//
// Zoom has no API for this, so it is read from outside, with two facts Windows already keeps:
//   - Camera: Windows records every app that uses the webcam (the "camera in use" light in Privacy
//     settings). An app that has the camera open has a start time and no stop time yet.
//   - Meeting: Zoom's window is titled "Zoom Meeting" (or "Zoom Webinar") only while one is going,
//     and its helper CptHost.exe runs only during a meeting.
// Zoom lets go of the camera when the video is turned off, so "in a meeting, camera not in use"
// means the camera is off. Nothing here reads the video, the window contents or the audio.

const { execFile } = require('child_process');

const CAMERA_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged';
const EXEC_TIMEOUT_MS = 5000;

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: EXEC_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

/** A REG_QWORD value such as 0x1dbc3a2f4e5d6c7 as a BigInt; 0n when missing or unreadable. */
function qword(hex) {
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

/**
 * Reads `reg query ... /s` output for the webcam consent store and says whether any Zoom program
 * has the camera open right now: it has started using it and has not stopped (Stop is 0, or older
 * than Start).
 */
function zoomCameraInUse(regOutput) {
  const blocks = String(regOutput).split(/\r?\n(?=HKEY_)/);
  for (const block of blocks) {
    const header = block.split(/\r?\n/, 1)[0] || '';
    if (!/zoom/i.test(header)) continue;
    const start = /LastUsedTimeStart\s+REG_QWORD\s+(0x[0-9a-f]+)/i.exec(block);
    const stop = /LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+)/i.exec(block);
    if (!start) continue;
    const startAt = qword(start[1]);
    const stopAt = stop ? qword(stop[1]) : 0n;
    if (startAt > 0n && (stopAt === 0n || startAt > stopAt)) return true;
  }
  return false;
}

/**
 * Reads `tasklist /v /fo csv /nh` rows for Zoom and says whether a meeting is on: a window titled
 * Zoom Meeting or Zoom Webinar, or the meeting-only helper process running.
 */
function zoomInMeeting(tasklistOutput) {
  const text = String(tasklistOutput);
  if (/"CptHost\.exe"/i.test(text)) return true;
  return text.split(/\r?\n/).some((line) => /^"Zoom\.exe"/i.test(line) && /zoom (meeting|webinar)/i.test(line));
}

/**
 * @param {object} [deps] { exec(file, args) => Promise<string>, platform } for tests
 * @returns {() => Promise<{supported: boolean, inMeeting: boolean, cameraOn: boolean}>}
 */
function createZoomWatcher({ exec = run, platform = process.platform } = {}) {
  return async function check() {
    if (platform !== 'win32') return { supported: false, inMeeting: false, cameraOn: false };
    try {
      // Zoom's own processes only: tasklist filters are cheap, so this is fine every few seconds.
      const [zoomRows, helperRows] = await Promise.all([
        exec('tasklist', ['/v', '/fo', 'csv', '/nh', '/fi', 'IMAGENAME eq Zoom.exe']),
        exec('tasklist', ['/v', '/fo', 'csv', '/nh', '/fi', 'IMAGENAME eq CptHost.exe']),
      ]);
      const inMeeting = zoomInMeeting(`${zoomRows}\n${helperRows}`);
      // Only worth reading the camera record during a meeting.
      const cameraOn = inMeeting ? zoomCameraInUse(await exec('reg', ['query', CAMERA_KEY, '/s'])) : false;
      return { supported: true, inMeeting, cameraOn };
    } catch {
      // Cannot tell (tasklist or reg blocked): say so, so the agent does nothing rather than guess.
      return { supported: false, inMeeting: false, cameraOn: false };
    }
  };
}

module.exports = { createZoomWatcher, zoomCameraInUse, zoomInMeeting };
