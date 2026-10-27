'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patch, post } from '@/lib/client';
import { FEATURE_LIST, timeZoneNames } from '@/lib/features';
import InviteCard from '@/components/InviteCard';

export default function CompanyControls({ company, admins }) {
  const router = useRouter();
  const [features, setFeatures] = useState(company.features);
  const [timezone, setTimezone] = useState(company.timezone);
  // Limits are typed in GB and people; empty means no limit.
  const [storageGb, setStorageGb] = useState(
    company.storageLimitBytes == null ? '' : String(company.storageLimitBytes / 1024 ** 3)
  );
  const [maxPeople, setMaxPeople] = useState(company.maxEmployees == null ? '' : String(company.maxEmployees));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState(null);

  const changed = FEATURE_LIST.some((f) => features[f.key] !== company.features[f.key]);

  async function run(fn, done) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const saveFeatures = () =>
    run(
      () => patch(`/api/super/companies/${company.id}`, { features }),
      'Features saved. They apply within a few seconds.'
    );

  const saveTimezone = () =>
    run(
      () => patch(`/api/super/companies/${company.id}`, { timezone }),
      'Time zone saved. Days and months now follow this clock.'
    );

  const saveLimits = () =>
    run(
      () =>
        patch(`/api/super/companies/${company.id}`, {
          storageLimitBytes: storageGb === '' ? null : Math.round(Number(storageGb) * 1024 ** 3),
          maxEmployees: maxPeople === '' ? null : Math.round(Number(maxPeople)),
        }),
      'Limits saved.'
    );

  const setStatus = (status) =>
    run(
      () => patch(`/api/super/companies/${company.id}`, { status }),
      status === 'suspended' ? 'Company suspended.' : 'Company reactivated.'
    );

  async function resetPassword(person) {
    setBusy(true);
    setError(null);
    try {
      const res = await post(`/api/super/companies/${company.id}/admins/${person.id}/reset-password`);
      setInvite({ name: person.name, email: person.email, password: res.temporaryPassword });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {message && <div className="notice notice-info">{message}</div>}

      <div className="card">
        <div className="card-head">
          <h2>Features</h2>
          <span className={`pill ${company.status === 'active' ? 'pill-working' : 'pill-out'}`}>
            {company.status}
          </span>
        </div>
        <div className="card-pad">
          <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
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
                  <span className="faint" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
                    {f.help}
                  </span>
                </span>
              </label>
            ))}
            <span className="faint" style={{ fontSize: 12 }}>
              Punch in/out, breaks and attendance are always on.
            </span>
          </div>
          <div className="inline">
            <button type="button" className="btn btn-primary" onClick={saveFeatures} disabled={busy || !changed}>
              Save features
            </button>
            {company.status === 'active' ? (
              <button type="button" className="btn" onClick={() => setStatus('suspended')} disabled={busy}>
                Suspend company
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setStatus('active')} disabled={busy}>
                Reactivate company
              </button>
            )}
          </div>
          <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
            Switching a feature off hides it from that company&apos;s menus and stops its data being
            collected or shown. Data already collected is kept. Suspending signs everyone out and
            blocks sign-in until you reactivate.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Plan limits</h2>
        </div>
        <div className="card-pad">
          <div className="inline" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="lim-storage">Storage limit (GB)</label>
              <input
                id="lim-storage"
                type="number"
                min="0"
                step="0.1"
                value={storageGb}
                onChange={(e) => setStorageGb(e.target.value)}
                placeholder="No limit"
                disabled={busy}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="lim-people">Max active employees</label>
              <input
                id="lim-people"
                type="number"
                min="1"
                step="1"
                value={maxPeople}
                onChange={(e) => setMaxPeople(e.target.value)}
                placeholder="No limit"
                disabled={busy}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={saveLimits} disabled={busy}>
              Save limits
            </button>
          </div>
          <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>
            Leave a box empty for no limit. Past the storage limit new screenshots, audio and leave
            proofs are not saved (agents drop them, the portal says so). Past the employee limit HR
            cannot add or reactivate people. Nothing already stored is deleted.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Time zone</h2>
        </div>
        <div className="card-pad">
          <div className="inline" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input
              list="co-tz-list"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 280 }}
              aria-label="Company time zone"
            />
            <datalist id="co-tz-list">
              {timeZoneNames().map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveTimezone}
              disabled={busy || !timezone || timezone === company.timezone}
            >
              Save time zone
            </button>
          </div>
          <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>
            The company&apos;s own clock: what counts as today, the shift date and the month for its
            people. New employees start with this zone.
          </p>
        </div>
      </div>

      {invite && (
        <InviteCard
          name={invite.name}
          email={invite.email}
          password={invite.password}
          title={`New temporary password for ${invite.name}`}
          onDone={() => setInvite(null)}
        />
      )}

      <div className="card">
        <div className="card-head">
          <h2>HR / admins</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    <div className="faint" style={{ fontSize: 12 }}>{a.email}</div>
                  </td>
                  <td>{a.status}</td>
                  <td>
                    {a.status === 'active' && (
                      <button type="button" className="btn" onClick={() => resetPassword(a)} disabled={busy}>
                        Reset password
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
