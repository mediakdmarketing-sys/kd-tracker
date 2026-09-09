'use strict';

// Performance indexes identified in the September 2026 audit.
//
// 1. attendance(employee_id, status)
//    openShift() — called on every punch-in, punch-out, break-start, break-end, and every
//    capture upload — queries WHERE employee_id = ? AND status IN ('open','on_break').
//    The existing idx_attendance_status on (status) alone forces a scan of all rows for an
//    employee; this composite index makes it a single seek.
//
// 2. activity_logs(employee_id, date)
//    listActivity() filters by employee_id AND date (a string column). The existing
//    idx_activity_employee_ts is on (employee_id, timestamp) — not usable for date-string
//    filters. This index covers the common "show a day's activity for an employee" query.

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_status
    ON attendance (employee_id, status)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_activity_employee_date
    ON activity_logs (employee_id, date)
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_attendance_employee_status');
  await knex.raw('DROP INDEX IF EXISTS idx_activity_employee_date');
};
