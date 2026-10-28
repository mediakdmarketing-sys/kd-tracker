'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';
import { FEATURE_LIST, timeZoneNames } from '@/lib/features';
import InviteCard from '@/components/InviteCard';

const allOn = () => Object.fromEntries(FEATURE_LIST.map((f) => [f.key, true]));

export default function CreateCompanyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [features, setFeatures] = useState(allOn);
  const [timezone, setTimezone] = useState('');
  const [storageGb, setStorageGb] = useState('');
  const [maxPeople, setMaxPeople] = useState('');
  const [plan, setPlan] = useState('pro');
  const [trialDays, setTrialDays] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(null);

  function close() {
    setOpen(false);
    setName('');
    setAdminName('');
    setAdminEmail('');
    setFeatures(allOn());
    setTimezone('');
    setStorageGb('');
    setMaxPeople('');
    setPlan('pro');
    setTrialDays('');
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await post('/api/super/companies', {
        name,
        plan,
        ...(trialDays !== '' && { trialDays: Math.round(Number(trialDays)) }),
        // Free and Pro set their own features and limits; only Custom takes them from this form.
        ...(plan === 'custom' && { features }),
        ...(timezone && { timezone }),
        ...(plan === 'custom' && storageGb !== '' && { storageLimitBytes: Math.round(Number(storageGb) * 1024 ** 3) }),
        ...(plan === 'custom' && maxPeople !== '' && { maxEmployees: Math.round(Number(maxPeople)) }),
        admin: { name: adminName, email: adminEmail },
      });
      setInvite({
        company: created.company.name,
        name: created.admin.name,
        email: created.admin.email,
        password: created.admin.temporaryPassword,
      });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (invite) {
    return (
      <InviteCard
        name={invite.name}
        email={invite.email}
        password={invite.password}
        title={`${invite.company} was created: send the first admin their invitation`}
        onDone={() => {
          setInvite(null);
          close();
        }}
      />
    );
  }

  if (!open) {
    return (
      <div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Add company
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Add company</h2>
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
      <div className="card-pad">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          <div className="filters" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="nc-name">Company name</label>
              <input id="nc-name" required value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="nc-admin">First HR / admin name</label>
              <input id="nc-admin" required value={adminName} onChange={(e) => setAdminName(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="nc-email">First HR / admin work email</label>
              <input id="nc-email" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} disabled={busy} />
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14, maxWidth: 360 }}>
            <label htmlFor="nc-tz">Time zone (the company's clock)</label>
            <input
              id="nc-tz"
              list="nc-tz-list"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Server default, or e.g. Asia/Kolkata"
              disabled={busy}
            />
            <datalist id="nc-tz-list">
              {timeZoneNames().map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>

          <div className="filters" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="nc-plan">Plan</label>
              <select id="nc-plan" value={plan} onChange={(e) => setPlan(e.target.value)} disabled={busy}>
                <option value="pro">Pro (100 people, 50 GB, everything)</option>
                <option value="free">Free (5 people, 1 GB, no capture or payroll)</option>
                <option value="custom">Custom (choose below)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-trial">Free trial days (optional)</label>
              <input id="nc-trial" type="number" min="1" max="365" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="No trial" disabled={busy} />
            </div>
          </div>

          {plan === 'custom' && (
          <div className="filters" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="nc-gb">Storage limit (GB, optional)</label>
              <input id="nc-gb" type="number" min="0" step="0.1" value={storageGb} onChange={(e) => setStorageGb(e.target.value)} placeholder="No limit" disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="nc-max">Max active employees (optional)</label>
              <input id="nc-max" type="number" min="1" step="1" value={maxPeople} onChange={(e) => setMaxPeople(e.target.value)} placeholder="No limit" disabled={busy} />
            </div>
          </div>
          )}

          {plan === 'custom' && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Features</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {FEATURE_LIST.map((f) => (
                <label key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={features[f.key]}
                    onChange={(e) => setFeatures((cur) => ({ ...cur, [f.key]: e.target.checked }))}
                    disabled={busy}
                    style={{ marginTop: 3, width: 'auto', flex: 'none' }}
                  />
                  <span>
                    {f.label}
                    <span className="faint" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>{f.help}</span>
                  </span>
                </label>
              ))}
              <span className="faint" style={{ fontSize: 12 }}>
                Punch in/out, breaks and attendance are always on.
              </span>
            </div>
          </div>
          )}

          <div className="inline">
            <button type="submit" className="btn btn-primary" disabled={busy || !name || !adminName || !adminEmail}>
              {busy ? 'Creating…' : 'Create company'}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
