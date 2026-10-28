'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch } from '@/lib/client';

const PLAN_LABEL = { free: 'Free', pro: 'Pro', custom: 'Custom' };
const toDateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/**
 * Plan, free trial and billing notes. There is no payment processing here: this decides what a
 * company may use and when it is switched off. Choosing Free or Pro sets the company's features and
 * limits to that plan's defaults.
 */
export default function PlanCard({ company }) {
  const router = useRouter();
  const [plan, setPlan] = useState(company.plan);
  const [trialEnd, setTrialEnd] = useState(toDateInput(company.trialEndsAt));
  const [autoSuspend, setAutoSuspend] = useState(company.autoSuspend);
  const [note, setNote] = useState(company.billingNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const planChanged = plan !== company.plan;
  const daysLeft = company.trialEndsAt ? Math.ceil((company.trialEndsAt - Date.now()) / 86400000) : null;

  function startTrial(days) {
    setTrialEnd(new Date(Date.now() + days * 86400000).toISOString().slice(0, 10));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch(`/api/super/companies/${company.id}`, {
        ...(planChanged && { plan }),
        // The end of the chosen day, so "until 30 Nov" includes the 30th.
        trialEndsAt: trialEnd ? new Date(`${trialEnd}T23:59:59`).toISOString() : null,
        autoSuspend,
        billingNote: note.trim() || null,
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Plan &amp; trial</h2>
        <span>
          <span className="pill pill-idle">{PLAN_LABEL[company.plan] || company.plan}</span>{' '}
          {company.trialExpired ? (
            <span className="pill pill-flag">{company.autoSuspend ? 'trial ended: blocked' : 'trial ended'}</span>
          ) : daysLeft !== null ? (
            <span className="pill pill-break">trial: {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
          ) : null}
        </span>
      </div>
      <div className="card-pad">
        {error && <div className="notice notice-danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}
        {saved && !error && <div className="notice notice-info" style={{ marginBottom: 12 }}>Saved.</div>}

        <div className="filters" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="pl-plan">Plan</label>
            <select id="pl-plan" value={plan} onChange={(e) => { setPlan(e.target.value); setSaved(false); }} disabled={busy}>
              <option value="free">Free (5 people, 1 GB, no capture or payroll)</option>
              <option value="pro">Pro (100 people, 50 GB, everything)</option>
              <option value="custom">Custom (set features and limits yourself)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pl-trial">Trial ends</label>
            <input id="pl-trial" type="date" value={trialEnd} onChange={(e) => { setTrialEnd(e.target.value); setSaved(false); }} disabled={busy} />
            <span className="inline" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => startTrial(14)} disabled={busy}>14 days</button>
              <button type="button" className="btn" onClick={() => startTrial(30)} disabled={busy}>30 days</button>
              <button type="button" className="btn" onClick={() => { setTrialEnd(''); setSaved(false); }} disabled={busy}>No trial</button>
            </span>
          </div>
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={autoSuspend}
            onChange={(e) => { setAutoSuspend(e.target.checked); setSaved(false); }}
            disabled={busy}
            style={{ marginTop: 3, width: 'auto', flex: 'none' }}
          />
          <span>
            Block the company automatically when the trial ends
            <span className="faint" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
              Sign-in and live sessions stop on the end date. Nothing is deleted; extend the date or switch this off to restore access.
            </span>
          </span>
        </label>

        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="pl-note">Billing note (only you see this)</label>
          <input id="pl-note" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="Invoice #, contract end, contact..." maxLength={1000} disabled={busy} />
        </div>

        {planChanged && plan !== 'custom' && (
          <div className="notice notice-warn" style={{ marginBottom: 12 }}>
            Saving replaces this company&apos;s features and limits with the {PLAN_LABEL[plan]} plan&apos;s defaults.
          </div>
        )}

        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save plan'}
        </button>
      </div>
    </div>
  );
}
