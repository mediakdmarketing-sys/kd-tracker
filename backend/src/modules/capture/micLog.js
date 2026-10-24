'use strict';

// The microphone log: from what time to what time an employee's mic was found muted.
//
// Nothing is stored for this. Every audio sample already records when it was taken, how long it
// ran and whether it was silent (`mic_muted`), so the periods are worked out from those rows
// when someone asks. That keeps the log consistent with the samples it is built from, and it
// survives the 31-day file purge, which deletes the audio but keeps these rows.
//
// What the log can and cannot say: a sample is taken every ~13 minutes (5 minutes recording,
// 8 minutes gap). A period therefore runs from the start of the first silent sample to the end
// of the last silent one, and the log says when the mic was next heard working. Between samples
// the mic's state is unknown, so the log never claims more than the samples show.

const { db } = require('../../db');
const t = require('../../utils/time');
const { toIso } = require('../../utils/http');

// Two samples further apart than this are not part of the same stretch: in between the person
// was most likely on a break or had punched out, so a silent mic can no longer be assumed.
const MAX_GAP_MS = 45 * 60 * 1000;

/**
 * Turns one employee's samples (oldest first) into muted periods.
 *
 * @param {Array<{recordedAt:number, durationSeconds:number, micMuted:boolean|null}>} samples
 * @returns {Array<{start:number, end:number, samples:number, endedBy:'live'|'gap'|'ongoing', confirmedLiveAt:number|null}>}
 *   endedBy: 'live'    the next sample heard sound, at confirmedLiveAt
 *            'gap'     no further sample within 45 minutes (break, punch-out, agent closed)
 *            'ongoing' the last sample was still silent
 */
function periodsFromSamples(samples) {
  const periods = [];
  let open = null;

  const close = (endedBy, liveAt = null) => {
    if (!open) return;
    periods.push({ ...open, endedBy, confirmedLiveAt: liveAt });
    open = null;
  };

  for (const sample of samples) {
    const end = sample.recordedAt + sample.durationSeconds * 1000;

    if (open && sample.recordedAt - open.end > MAX_GAP_MS) close('gap');

    if (sample.micMuted === true) {
      if (open) {
        open.end = Math.max(open.end, end);
        open.samples += 1;
      } else {
        open = { start: sample.recordedAt, end, samples: 1 };
      }
    } else if (sample.micMuted === false) {
      close('live', sample.recordedAt);
    }
    // null means the agent could not tell (an old build): it neither starts nor ends a period.
  }

  close('ongoing');
  return periods;
}

function shapePeriod(p, person) {
  return {
    ...(person ? { employeeId: person.id, employeeName: person.name, department: person.department } : {}),
    start: toIso(p.start),
    end: toIso(p.end),
    durationSeconds: Math.round((p.end - p.start) / 1000),
    samples: p.samples,
    endedBy: p.endedBy,
    confirmedLiveAt: p.confirmedLiveAt ? toIso(p.confirmedLiveAt) : null,
  };
}

/** Defaults to the last 7 days, on the company clock. */
function rangeOf({ from, to }) {
  return {
    from: from || t.localDate(t.daysAgo(6)),
    to: to || t.localDate(),
  };
}

/**
 * Muted periods in a date range, newest first.
 * @param {string[]|null} employeeIds  null = everyone (an admin); an array limits it (a leader).
 */
async function micLog({ employeeIds, from, to }) {
  const range = rangeOf({ from, to });
  if (employeeIds && !employeeIds.length) return { ...range, periods: [] };

  const base = db()('audio_recordings')
    .andWhere('date', '>=', range.from)
    .andWhere('date', '<=', range.to)
    .orderBy(['employee_id', 'recorded_at'])
    .select('employee_id', 'recorded_at', 'duration_seconds', 'mic_muted');
  if (employeeIds) base.whereIn('employee_id', employeeIds);
  const rows = await base;

  const byEmployee = new Map();
  for (const r of rows) {
    if (!byEmployee.has(r.employee_id)) byEmployee.set(r.employee_id, []);
    byEmployee.get(r.employee_id).push({
      recordedAt: Number(r.recorded_at),
      durationSeconds: Number(r.duration_seconds),
      micMuted: r.mic_muted === null || r.mic_muted === undefined ? null : Boolean(Number(r.mic_muted)),
    });
  }

  const ids = [...byEmployee.keys()];
  const people = ids.length
    ? await db()('employees').whereIn('id', ids).select('id', 'name', 'department')
    : [];
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));

  const periods = [];
  for (const [id, samples] of byEmployee) {
    for (const p of periodsFromSamples(samples)) periods.push(shapePeriod(p, personById[id]));
  }
  periods.sort((a, b) => (a.start < b.start ? 1 : -1));
  return { ...range, periods };
}

module.exports = { micLog, periodsFromSamples, MAX_GAP_MS };
