'use strict';

const config = require('../../config');
const { db, isUniqueViolation } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toBool, toIso } = require('../../utils/http');
const { resolveCaptureTime } = require('../../utils/eventTime');
const { storage, buildKey, extensionFor } = require('../../storage');
const attendanceService = require('../attendance/attendance.service');
const { forbidden, conflict, notFound, payloadTooLarge, badRequest } = require('../../utils/errors');

/**
 * Sprint 6.5 (ADR-0004) — replay protection.
 *
 * An agent that queues work offline retries whenever a response is lost, which happens on a
 * bad connection whether or not the server processed the request. Without this, every lost
 * response leaves a duplicate screenshot on disk and a duplicate activity row inflating the
 * employee's keystroke counts.
 *
 * Returns the already-stored row when the client has sent this `captureId` before.
 */
async function findByCaptureId(table, employeeId, captureId) {
  if (!captureId) return null;
  return db()(table).where({ capture_id: captureId, employee_id: employeeId }).first();
}

/** Accepts a bare base64 string or a `data:` URL; enforces the size cap before allocating. */
function decodeBase64(input, { field }) {
  const cleaned = String(input).replace(/^data:[^;]+;base64,/, '');

  // 4 base64 chars encode 3 bytes — check the encoded length first so a hostile client cannot
  // make us materialise a huge buffer just to reject it.
  const approxBytes = Math.floor((cleaned.length * 3) / 4);
  if (approxBytes > config.capture.maxUploadBytes) {
    throw payloadTooLarge(
      `${field} exceeds the ${Math.round(config.capture.maxUploadBytes / 1024)} KB upload limit`
    );
  }

  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) throw badRequest(`${field} is not valid base64 data`);
  return buffer;
}

/**
 * Capture is only accepted for time the employee was actually on shift and not on a break
 * (spec 6.2/6.3). The agent enforces this too; the server does it as well, because the agent
 * runs on a machine we do not control.
 *
 * The test is against the moment of capture, not the moment of upload. A screenshot taken at
 * 14:00 and delivered at 18:00 by an agent that was offline is valid: rejecting it because the
 * shift has since closed would leave the agent retrying an item that can never be accepted
 * (ADR-0004).
 */
async function requireCapturableShift(employee, at = t.now()) {
  const shift = await db()('attendance')
    .where({ employee_id: employee.id })
    .andWhere('punch_in', '<=', at)
    .andWhere((b) => b.whereNull('punch_out').orWhere('punch_out', '>=', at))
    .orderBy('punch_in', 'desc')
    .first();

  if (!shift) {
    throw conflict('Capture is only accepted for time that falls inside a shift.', {
      capturedAt: toIso(at),
    });
  }

  // Was the employee on a break at that moment? Checked against the break rows rather than
  // the shift's current status, so a queued capture is judged by the state at capture time.
  const onBreak = await db()('breaks')
    .where({ attendance_id: shift.id })
    .andWhere('break_start', '<=', at)
    .andWhere((b) => b.whereNull('break_end').orWhere('break_end', '>=', at))
    .first();

  if (onBreak) throw conflict('Capture is not accepted during a break.');

  return shift;
}

/**
 * One display's image from one capture moment (ADR-0005).
 *
 * The agent uploads each display separately rather than as one batched request: a 3-monitor
 * capture would otherwise be a ~1 MB payload where a single flaky upload loses all of it,
 * and retry granularity is per-display for free this way.
 */
async function uploadScreenshot({
  employee,
  imageBase64,
  capturedAt,
  contentType = 'image/jpeg',
  captureId,
  captureGroupId,
  displayIndex = 0,
  displayCount = 1,
  displayLabel,
}) {
  // Checked before anything else: a replay must not be rejected just because the shift it
  // belongs to has since closed, and must not cost a file write.
  const existing = await findByCaptureId('screenshots', employee.id, captureId);
  if (existing) {
    return {
      id: existing.id,
      capturedAt: toIso(existing.captured_at),
      sizeBytes: existing.size_bytes,
      date: existing.date,
      captureGroupId: existing.capture_group_id,
      displayIndex: existing.display_index,
      duplicate: true,
    };
  }

  // Resolve the capture time first: which shift this belongs to is decided by when it was
  // taken, not by when it arrived.
  const at = resolveCaptureTime(capturedAt, 'capturedAt');
  const shift = await requireCapturableShift(employee, at);
  const buffer = decodeBase64(imageBase64, { field: 'imageBase64' });

  const id = uuid();
  const date = t.localDate(at, employee.timezone);
  // The storage key uses a server-generated id, not the client's `captureId` — a client
  // value has no business shaping a filesystem or bucket path.
  const key = buildKey({
    type: 'screenshots',
    employeeId: employee.id,
    date,
    id,
    extension: extensionFor(contentType, 'jpg'),
  });

  await storage().put(key, buffer, contentType);

  const row = {
    id,
    employee_id: employee.id,
    attendance_id: shift.id,
    capture_id: captureId || null,
    // A single-display capture is a group of one, so the viewer has no special case.
    capture_group_id: captureGroupId || captureId || id,
    display_index: displayIndex,
    display_count: displayCount,
    display_label: displayLabel ? String(displayLabel).slice(0, 120) : null,
    image_url: key,
    captured_at: at,
    date,
    size_bytes: buffer.length,
    content_type: contentType,
    file_deleted: false,
    created_at: t.now(),
  };

  try {
    await db()('screenshots').insert(row);
  } catch (err) {
    // Two retries in flight at once. The other one won; drop the file this one just wrote.
    if (!isUniqueViolation(err)) throw err;
    await storage().remove(key);
    const winner = await findByCaptureId('screenshots', employee.id, captureId);
    return {
      id: winner.id,
      capturedAt: toIso(winner.captured_at),
      sizeBytes: winner.size_bytes,
      date: winner.date,
      captureGroupId: winner.capture_group_id,
      displayIndex: winner.display_index,
      duplicate: true,
    };
  }

  return {
    id,
    capturedAt: toIso(at),
    sizeBytes: buffer.length,
    date,
    captureGroupId: row.capture_group_id,
    displayIndex,
    duplicate: false,
  };
}

async function uploadAudio({
  employee,
  audioBase64,
  recordedAt,
  durationSeconds,
  contentType = 'audio/webm',
  captureId,
  micMuted = null,
}) {
  // Story C-3, the hard gate. Checked against the employee row loaded this request, so a
  // revocation takes effect on the very next upload rather than at token expiry.
  //
  // Deliberately ahead of the replay check: if consent was withdrawn since the sample was
  // queued, a retry must still be refused.
  if (!employee.consentAudio) {
    throw forbidden(
      'Audio consent has not been given for this employee. This upload was rejected and nothing was stored.'
    );
  }

  const existing = await findByCaptureId('audio_recordings', employee.id, captureId);
  if (existing) {
    return {
      id: existing.id,
      recordedAt: toIso(existing.recorded_at),
      durationSeconds: existing.duration_seconds,
      sizeBytes: existing.size_bytes,
      date: existing.date,
      duplicate: true,
    };
  }

  const at = resolveCaptureTime(recordedAt, 'recordedAt');
  const shift = await requireCapturableShift(employee, at);
  const buffer = decodeBase64(audioBase64, { field: 'audioBase64' });

  // A sample longer than the configured window means a misconfigured or tampered agent —
  // continuous recording is exactly what the sampling design exists to prevent (spec 6.3).
  const maxDuration = config.capture.audioSampleDurationSec * 1.5;
  if (durationSeconds > maxDuration) {
    throw badRequest(
      `Audio sample of ${durationSeconds}s exceeds the maximum sample length of ${Math.floor(
        maxDuration
      )}s. Samples must be periodic, not continuous.`
    );
  }

  const id = uuid();
  const date = t.localDate(at, employee.timezone);
  const key = buildKey({
    type: 'audio',
    employeeId: employee.id,
    date,
    id,
    extension: extensionFor(contentType, 'webm'),
  });

  await storage().put(key, buffer, contentType);

  try {
    await db()('audio_recordings').insert({
      id,
      employee_id: employee.id,
      attendance_id: shift.id,
      capture_id: captureId || null,
      file_url: key,
      recorded_at: at,
      date,
      duration_seconds: durationSeconds,
      size_bytes: buffer.length,
      content_type: contentType,
      // Recorded on the row itself: proof that consent was in force when this sample was taken.
      consent_verified: true,
      // null = agent could not determine; false = audio detected; true = silence (mic muted)
      mic_muted: micMuted !== undefined ? micMuted : null,
      file_deleted: false,
      created_at: t.now(),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await storage().remove(key);
    const winner = await findByCaptureId('audio_recordings', employee.id, captureId);
    return {
      id: winner.id,
      recordedAt: toIso(winner.recorded_at),
      durationSeconds: winner.duration_seconds,
      sizeBytes: winner.size_bytes,
      date: winner.date,
      duplicate: true,
    };
  }

  return {
    id,
    recordedAt: toIso(at),
    durationSeconds,
    sizeBytes: buffer.length,
    date,
    duplicate: false,
  };
}

/**
 * Activity counters. Accepts one entry or a batch, so an agent that was offline can drain its
 * queue in a single request (story C-5).
 */
async function logActivity({ employee, entries }) {
  const shift = await attendanceService.openShift(employee.id);
  const nowMs = t.now();

  // Drop entries the agent has already delivered. Duplicated activity would inflate keystroke
  // totals and, worse, fill in gaps that idle detection is supposed to find.
  const captureIds = entries.map((e) => e.captureId).filter(Boolean);
  let seen = new Set();
  if (captureIds.length) {
    const found = await db()('activity_logs')
      .where({ employee_id: employee.id })
      .whereIn('capture_id', captureIds)
      .select('capture_id');
    seen = new Set(found.map((r) => r.capture_id));
  }

  // Also deduplicate within the batch itself: two entries with the same captureId in the
  // same request would both pass the `seen` check (which only covers DB rows), then the
  // second one would collide on the unique index and fail the entire batchInsert.
  const seenInBatch = new Set();
  const rows = entries
    .filter((e) => {
      if (e.captureId && seen.has(e.captureId)) return false;
      if (e.captureId) {
        if (seenInBatch.has(e.captureId)) return false;
        seenInBatch.add(e.captureId);
      }
      return true;
    })
    .map((e) => {
      const at = resolveCaptureTime(e.timestamp, 'timestamp', nowMs);
      return {
        id: uuid(),
        employee_id: employee.id,
        // A queued entry may belong to a shift that has since closed; leaving it null is
        // correct — the row still counts for idle analysis via its timestamp.
        attendance_id: shift ? shift.id : null,
        capture_id: e.captureId || null,
        keystroke_count: e.keystrokeCount,
        mouse_count: e.mouseCount,
        window_title: e.windowTitle ? String(e.windowTitle).slice(0, 255) : null,
        timestamp: at,
        date: t.localDate(at, employee.timezone),
        created_at: nowMs,
      };
    });

  let accepted = rows.length;

  if (rows.length) {
    try {
      await db().batchInsert('activity_logs', rows, 100);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent drains overlapped. Retry row-by-row inside a single transaction so one
      // collision does not lose the whole batch, but we only pay one fsync rather than N.
      accepted = 0;
      await db().transaction(async (trx) => {
        for (const row of rows) {
          try {
            await trx('activity_logs').insert(row);
            accepted += 1;
          } catch (rowErr) {
            if (!isUniqueViolation(rowErr)) throw rowErr;
            // Duplicate — already delivered. Skip and continue.
          }
        }
      });
    }
  }

  return { accepted, duplicates: entries.length - accepted };
}

// --- Admin reads -----------------------------------------------------------------------

function shapeScreenshot(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    capturedAt: toIso(row.captured_at),
    date: row.date,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    fileDeleted: toBool(row.file_deleted),
    // Rows are returned flat and grouped by the client: paginating groups server-side would
    // mean a page size that varies with how many monitors somebody happens to have.
    captureGroupId: row.capture_group_id || row.id,
    displayIndex: row.display_index ?? 0,
    displayCount: row.display_count ?? 1,
    displayLabel: row.display_label,
    // Null once purged: the row is kept forever, the file is not (spec 6.4).
    fileUrl: toBool(row.file_deleted) ? null : `/api/screenshots/file/${row.id}`,
  };
}

function shapeAudio(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    recordedAt: toIso(row.recorded_at),
    date: row.date,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    consentVerified: toBool(row.consent_verified),
    // null = agent could not determine; false = audio detected; true = silence (mic muted)
    micMuted: row.mic_muted === null || row.mic_muted === undefined ? null : toBool(row.mic_muted),
    fileDeleted: toBool(row.file_deleted),
    fileUrl: toBool(row.file_deleted) ? null : `/api/audio/file/${row.id}`,
  };
}

async function listScreenshots({ employeeId, date, from, to, limit, offset }) {
  const base = db()('screenshots').where({ employee_id: employeeId });
  if (date) base.andWhere({ date });
  if (from) base.andWhere('date', '>=', from);
  if (to) base.andWhere('date', '<=', to);

  const [{ count }] = await base.clone().count({ count: '*' });
  // Newest moment first, and within a moment the primary display first, so the client can
  // group consecutive rows without re-sorting.
  const rows = await base
    .clone()
    .orderBy([{ column: 'captured_at', order: 'desc' }, { column: 'display_index', order: 'asc' }])
    .limit(limit)
    .offset(offset);
  return { rows: rows.map(shapeScreenshot), total: Number(count) };
}

async function listAudio({ employeeId, date, from, to, limit, offset }) {
  const base = db()('audio_recordings').where({ employee_id: employeeId });
  if (date) base.andWhere({ date });
  if (from) base.andWhere('date', '>=', from);
  if (to) base.andWhere('date', '<=', to);

  const [{ count }] = await base.clone().count({ count: '*' });
  const rows = await base.clone().orderBy('recorded_at', 'desc').limit(limit).offset(offset);
  return { rows: rows.map(shapeAudio), total: Number(count) };
}

/** Streams the actual file. Callers must have written an audit row first. */
async function readFile(table, id) {
  const row = await db()(table).where({ id }).first();
  if (!row) throw notFound('Recording not found');

  const key = table === 'screenshots' ? row.image_url : row.file_url;
  if (toBool(row.file_deleted) || !key) {
    throw notFound(
      `The file was deleted under the ${config.retention.days}-day retention policy. The record of the capture is retained.`
    );
  }

  const buffer = await storage().get(key);
  return { buffer, contentType: row.content_type || 'application/octet-stream', row };
}

async function listActivity({ employeeId, date, from, to, limit, offset }) {
  const base = db()('activity_logs').where({ employee_id: employeeId });
  if (date) base.andWhere({ date });
  if (from) base.andWhere('date', '>=', from);
  if (to) base.andWhere('date', '<=', to);

  const [{ count }] = await base.clone().count({ count: '*' });
  const rows = await base.clone().orderBy('timestamp', 'desc').limit(limit).offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      keystrokeCount: r.keystroke_count,
      mouseCount: r.mouse_count,
      windowTitle: r.window_title,
      timestamp: toIso(r.timestamp),
      date: r.date,
    })),
    total: Number(count),
  };
}

module.exports = {
  uploadScreenshot,
  uploadAudio,
  logActivity,
  listScreenshots,
  listAudio,
  listActivity,
  readFile,
  decodeBase64,
  requireCapturableShift,
};
