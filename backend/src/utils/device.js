'use strict';

// What a sign-in came from. A user agent is only a hint (anyone can send any text), so it is used to
// tell a person which of their devices is which and to notice an unfamiliar one, never as proof of
// anything.

const crypto = require('crypto');
const config = require('../config');

function browserOf(ua) {
  if (/WorkInvigilator|WorkBuddy|Electron/i.test(ua)) return 'Desktop app';
  if (/okhttp|Dalvik/i.test(ua)) return 'Android app';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua) || /CriOS/i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Unknown browser';
}

function osOf(ua) {
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown system';
}

/**
 * @returns {{ label: string, hash: string }}  e.g. "Chrome on Windows". The hash covers the browser,
 *   the system and the kind of app, not the version, so a browser update is not a "new device".
 */
function describe(userAgent, client) {
  const ua = String(userAgent || '');
  const browser = browserOf(ua);
  const os = osOf(ua);
  const label = browser === 'Unknown browser' && os === 'Unknown system' ? 'Unknown device' : `${browser} on ${os}`;
  const hash = crypto.createHash('sha256').update(`${browser}|${os}|${client || ''}`).digest('hex');
  return { label, hash };
}

/**
 * The address and browser of the person signing in. When the portal's server makes the call for them,
 * it passes both along and proves it is the portal with the shared key (BFF_KEY): without the key the
 * headers are ignored, because anyone could send them. Without a configured key the request's own
 * address and user agent are used.
 */
function clientInfo(req) {
  const key = config.auth.bffKey;
  const given = req.headers['x-bff-key'];
  const trusted = Boolean(key) && typeof given === 'string' && given.length === key.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  const ip = trusted ? String(req.headers['x-client-ip'] || '').split(',')[0].trim() || req.ip : req.ip;
  const userAgent = trusted ? String(req.headers['x-client-ua'] || req.headers['user-agent'] || '') : String(req.headers['user-agent'] || '');
  return { ip: String(ip || '').slice(0, 64), userAgent: userAgent.slice(0, 255) };
}

module.exports = { describe, clientInfo };
