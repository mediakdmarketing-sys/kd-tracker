'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';
import PayslipSheet from '@/components/PayslipSheet';
import { FONT_LABELS } from '@/lib/payslipTemplate';

// A made-up payslip, so the preview always has something to show, whatever the real data is.
const SAMPLE = {
  month: '2026-07',
  generatedOn: '2026-08-01T12:00:00.000Z',
  employee: { name: 'Sample Employee', email: 'sample@company.com', department: 'Sales', employeeCode: 'KD0001' },
  daysWorked: 21,
  fullDays: 18,
  halfDays: 2,
  otherDays: 1,
  otherHours: 3.5,
  totalHours: 181.5,
  dayLimits: { fullDayHours: 9, halfDayHours: 4.5 },
  lines: [
    { kind: 'full', dailyRate: 90, days: 18, hours: 162, hourlyRate: null, amount: 1620 },
    { kind: 'half', dailyRate: 90, days: 2, hours: 12, hourlyRate: null, amount: 90 },
    { kind: 'partial', dailyRate: 90, days: 1, hours: 3.5, hourlyRate: 10, amount: 35 },
  ],
  basePay: 1745,
  bonuses: [{ id: 'b1', reason: 'Festival bonus', amount: 100 }],
  bonusTotal: 100,
  netPay: 1845,
};

// One-click starting points; every colour can still be changed afterwards.
const PRESETS = [
  { name: 'Standard', colors: { background: '#ffffff', headerBackground: '#ffffff', text: '#1a1b2e', accent: '#5b3fd6' } },
  { name: 'Green', colors: { background: '#ffffff', headerBackground: '#e8f5ee', text: '#16302b', accent: '#0b6e4f' } },
  { name: 'Navy', colors: { background: '#ffffff', headerBackground: '#0f2a4a', text: '#1b2733', accent: '#0f2a4a' } },
  { name: 'Warm', colors: { background: '#fffaf0', headerBackground: '#fdebd0', text: '#3b2a1a', accent: '#b45309' } },
];

const COLOUR_FIELDS = [
  ['background', 'Sheet background'],
  ['headerBackground', 'Header band'],
  ['text', 'Text'],
  ['accent', 'Accent (name, lines, net pay)'],
];

const SHOW_FIELDS = [
  ['logo', 'Company logo'],
  ['employeeId', 'Employee ID'],
  ['email', 'Employee email'],
  ['department', 'Department'],
  ['totalHours', 'Total hours worked'],
  ['dayBreakdown', 'Full / half days and other hours'],
  ['rulesNote', 'Closing note'],
];

/** HR designs the payslip here: colours, font, title, closing note and what it shows. Applies to the page, the PDF and the email. */
export default function PayslipTemplateCard({ template, defaults, company }) {
  const router = useRouter();
  const [draft, setDraft] = useState(template);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const changed = JSON.stringify(draft) !== JSON.stringify(template);

  function edit(fn) {
    setDraft((d) => fn(d));
    setSaved(false);
  }

  async function save(next = draft) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await patch('/api/admin/settings', { payslip: next });
      setDraft(res.payslip);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" id="payslip-look">
      <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>Payslip look</div>
      <p className="faint" style={{ margin: '0 0 14px', fontSize: 12 }}>
        How payslips look on screen, as a PDF and in the email. The preview shows a sample payslip.
      </p>

      {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
      {saved && !error && <div className="notice notice-info" style={{ marginBottom: 12 }} role="status">Saved. New payslips and emails use this look.</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Start from</div>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => edit((d) => ({ ...d, colors: p.colors }))}
              >
                <span
                  style={{ width: 12, height: 12, borderRadius: 3, background: p.colors.accent, border: '1px solid rgba(0,0,0,.2)', display: 'inline-block', marginRight: 6 }}
                />
                {p.name}
              </button>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {COLOUR_FIELDS.map(([key, label]) => (
              <div className="field" style={{ margin: 0 }} key={key}>
                <label htmlFor={`pc-${key}`}>{label}</label>
                <div className="inline" style={{ gap: 8 }}>
                  <input
                    id={`pc-${key}`}
                    type="color"
                    value={draft.colors[key]}
                    disabled={busy}
                    onChange={(e) => edit((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value } }))}
                    style={{ width: 44, height: 34, padding: 2 }}
                  />
                  <code className="faint">{draft.colors[key]}</code>
                </div>
              </div>
            ))}
          </div>

          <div className="field">
            <label htmlFor="pt-title">Title</label>
            <input
              id="pt-title"
              value={draft.title}
              maxLength={40}
              disabled={busy}
              onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))}
              placeholder="Payslip"
            />
          </div>

          <div className="field">
            <label htmlFor="pt-font">Font</label>
            <select id="pt-font" value={draft.font} disabled={busy} onChange={(e) => edit((d) => ({ ...d, font: e.target.value }))}>
              {Object.entries(FONT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pt-note">Closing note (leave empty for the standard explanation)</label>
            <textarea
              id="pt-note"
              rows={3}
              maxLength={600}
              value={draft.footerNote}
              disabled={busy}
              onChange={(e) => edit((d) => ({ ...d, footerNote: e.target.value }))}
              placeholder="e.g. Salary is paid on the 5th. Questions: hr@yourcompany.com"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ fontWeight: 650, fontSize: 13, margin: '4px 0 8px' }}>Show on the payslip</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
            {SHOW_FIELDS.map(([key, label]) => (
              <label key={key} className="inline" style={{ gap: 8, cursor: busy ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.show[key]}
                  disabled={busy}
                  onChange={(e) => edit((d) => ({ ...d, show: { ...d.show, [key]: e.target.checked } }))}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => save()}>
              {busy ? 'Saving…' : 'Save look'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || JSON.stringify(draft) === JSON.stringify(defaults)}
              onClick={() => window.confirm('Go back to the standard look?') && save(defaults)}
            >
              Reset to standard
            </button>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Preview</div>
          <div style={{ transformOrigin: 'top left' }}>
            <PayslipSheet slip={SAMPLE} company={company} template={draft} monthTitle="July 2026" />
          </div>
        </div>
      </div>
    </div>
  );
}
