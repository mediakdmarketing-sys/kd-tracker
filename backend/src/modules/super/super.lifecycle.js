'use strict';

// The end of a company's life on the platform: a full export of its records (what the customer is
// owed when a contract ends) and a permanent delete of everything it holds.

const { db, transaction } = require('../../db');
const { storage } = require('../../storage');
const logger = require('../../utils/logger');
const t = require('../../utils/time');
const { badRequest, notFound, conflict } = require('../../utils/errors');
const companies = require('../../services/companies');

const people = (companyId) => db()('employees').where({ company_id: companyId }).select('id');
const attendanceOf = (companyId) => db()('attendance').whereIn('employee_id', people(companyId)).select('id');

/**
 * Every record the company owns, as plain data. Photos, recordings and proof files are listed by
 * name and size but not included (they are in storage, and can be large); passwords and sign-in
 * secrets are never included.
 */
async function exportCompany(id) {
  const company = await db()('companies').where({ id }).first();
  if (!company) throw notFound('Company not found');
  const own = (table) => db()(table).whereIn('employee_id', people(id));

  const employees = await db()('employees')
    .where({ company_id: id })
    .select('id', 'name', 'email', 'role', 'department', 'employee_code', 'status', 'timezone', 'created_at');
  const screenshots = await own('screenshots').select('id', 'employee_id', 'captured_at', 'date', 'size_bytes', 'content_type', 'file_deleted');
  const audio = await own('audio_recordings').select('id', 'employee_id', 'recorded_at', 'date', 'duration_seconds', 'size_bytes', 'file_deleted');

  return {
    exportedAt: new Date(t.now()).toISOString(),
    format: 'workbuddy-company-export/1',
    company: companies.shape(company),
    settings: await db()('settings').where({ company_id: id }).select(),
    departments: await db()('departments').where({ company_id: id }).select(),
    departmentLeaders: await db()('department_leaders').whereIn('employee_id', people(id)).select(),
    employees,
    attendance: await own('attendance').select(),
    breaks: await db()('breaks').whereIn('attendance_id', attendanceOf(id)).select(),
    leaveRequests: await own('leave_requests').select(
      'id', 'employee_id', 'type', 'start_date', 'end_date', 'day_part', 'reason', 'status', 'reviewed_by', 'reviewed_at', 'review_note', 'created_at'
    ),
    payroll: await own('payroll_summary').select(),
    auditLog: await db()('audit_logs').whereIn('admin_id', people(id)).select(),
    micEvents: await own('mic_events').select(),
    captureFiles: { screenshots, audioRecordings: audio },
    notIncluded: [
      'Screenshot, audio and leave-proof files themselves (listed under captureFiles)',
      'Activity pings (counts per minute)',
      'Passwords and sign-in secrets',
    ],
  };
}

/**
 * Permanently removes a company: every person, record and file. It has to be suspended first and
 * its exact name typed, so it cannot happen by a stray click or API call. `actorCompanyId` is the
 * deleter's own company, which can never be the one deleted.
 */
async function deleteCompany(id, { confirmName, actorCompanyId }) {
  const company = await db()('companies').where({ id }).first();
  if (!company) throw notFound('Company not found');
  if (company.is_internal) throw badRequest('That company cannot be deleted');
  if (id === actorCompanyId) throw badRequest('You cannot delete the company your own account belongs to');
  if (company.status !== 'suspended') throw conflict('Suspend the company first, then delete it');
  if (String(confirmName || '').trim() !== company.name) throw badRequest('The company name does not match');

  const own = (table) => db()(table).whereIn('employee_id', people(id));
  // Files are listed first: once the rows are gone there is no way to find them.
  const keys = [
    ...(await own('screenshots').whereNotNull('image_url').pluck('image_url')),
    ...(await own('audio_recordings').whereNotNull('file_url').pluck('file_url')),
    ...(await own('leave_requests').whereNotNull('proof_key').pluck('proof_key')),
    ...(company.logo_key ? [company.logo_key] : []),
  ];
  const [{ n: employeeCount }] = await db()('employees').where({ company_id: id }).count({ n: '*' });

  await transaction(async (trx) => {
    const ids = () => trx('employees').where({ company_id: id }).select('id');
    const mine = (table) => trx(table).whereIn('employee_id', ids());

    await trx('breaks').whereIn('attendance_id', trx('attendance').whereIn('employee_id', ids()).select('id')).del();
    await mine('project_time_entries').del();
    for (const table of ['activity_logs', 'screenshots', 'audio_recordings', 'mic_events', 'attendance', 'payroll_summary', 'notifications', 'refresh_tokens', 'agent_connect_codes', 'department_leaders']) {
      await mine(table).del();
    }
    await trx('leave_requests').whereIn('employee_id', ids()).del();
    await trx('audit_logs').whereIn('admin_id', ids()).del();
    await trx('employees').where({ company_id: id }).del();
    for (const table of ['departments', 'settings', 'app_categories', 'app_department_categories']) {
      await trx(table).where({ company_id: id }).del();
    }
    await trx('companies').where({ id }).del();
  });

  companies.invalidate(id);
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      await storage().remove(key);
      removed += 1;
    } catch (err) {
      failed += 1;
      logger.warn('Could not remove a file of a deleted company', { key, message: err.message });
    }
  }
  return { deleted: true, name: company.name, employees: Number(employeeCount), filesRemoved: removed, filesFailed: failed };
}

module.exports = { exportCompany, deleteCompany };
