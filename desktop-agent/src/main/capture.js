'use strict';

// Screen capture. The only file that talks to `desktopCapturer`.

const { desktopCapturer, screen, systemPreferences } = require('electron');
const logger = require('../core/logger');

// Full-resolution 4K screenshots are ~1 MB each even as JPEG, and with two monitors and a
// 5-minute cadence that is real load on a home upload link. Capping the long edge keeps text
// readable while staying inside the server's upload limit.
const MAX_EDGE = 1920;

/**
 * Captures every display, primary first.
 *
 * Displays are enumerated on every call, never cached: a monitor plugged in mid-shift would
 * otherwise stay invisible for the rest of the day (ADR-0005).
 *
 * @returns {Promise<Array<{buffer: Buffer, displayIndex: number, label: string, contentType: string}>>}
 */
async function captureAllDisplays({ quality = 70 } = {}) {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;

  // One thumbnailSize applies to every source, and Electron fits each thumbnail inside it
  // preserving aspect ratio — so size it to the largest display and let smaller ones come
  // back smaller. Sizing to the smallest would throw away detail on the big monitor.
  const scale = (d) => ({
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  });
  const widest = Math.max(...displays.map((d) => scale(d).width), 1);
  const tallest = Math.max(...displays.map((d) => scale(d).height), 1);
  const ratio = Math.min(1, MAX_EDGE / Math.max(widest, tallest));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    // Leaving this out is the classic mistake: the default is 150x150 and produces a
    // thumbnail far too small to be evidence of anything.
    thumbnailSize: {
      width: Math.round(widest * ratio),
      height: Math.round(tallest * ratio),
    },
    fetchWindowIcons: false,
  });

  const images = [];

  for (const source of sources) {
    if (source.thumbnail.isEmpty()) {
      // On macOS this is what a missing Screen Recording permission looks like: sources are
      // listed, thumbnails come back blank.
      logger.warn('Empty thumbnail for a display; screen recording permission may be missing', {
        sourceId: source.id,
      });
      continue;
    }

    const display = displays.find((d) => String(d.id) === String(source.display_id));

    images.push({
      buffer: source.thumbnail.toJPEG(quality),
      contentType: 'image/jpeg',
      displayId: source.display_id,
      isPrimary: display ? display.id === primaryId : false,
      label: display?.label || source.name || 'Display',
    });
  }

  // Primary display first, so `displayIndex: 0` means what the portal shows first.
  images.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  images.forEach((image, index) => {
    image.displayIndex = index;
  });

  return images;
}

/**
 * macOS gates screen capture behind a TCC permission that cannot be granted programmatically.
 * Without this check the agent silently captures nothing, which is the worst possible failure
 * for a monitoring tool — it looks like it is working.
 */
function screenPermissionState() {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

module.exports = { captureAllDisplays, screenPermissionState };
