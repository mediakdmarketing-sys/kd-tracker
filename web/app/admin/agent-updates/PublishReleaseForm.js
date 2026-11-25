'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client';

/**
 * HR publishes a new agent release: the version, and one line per change. Employees' agents then offer
 * the update. Upload the installer to the update feed BEFORE publishing, so the Update button has
 * something to download.
 */
export default function PublishReleaseForm({ newest }) {
  const router = useRouter();
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const lines = notes.split('\n').map((s) => s.trim()).filter(Boolean);
      const release = await post('/api/admin/agent-releases', { version: version.trim(), notes: lines, mandatory });
      setDone(`Version ${release.version} is published. Agents will offer it within the hour.`);
      setVersion('');
      setNotes('');
      setMandatory(false);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <div>
          <h2>Publish a new version</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            Upload the new installer to the update feed first. Agents then show an Update window with these notes.
          </span>
        </div>
      </div>
      <div className="card-pad stack">
        {error && <div className="notice notice-danger" role="alert">{error}</div>}
        {done && <div className="notice notice-info" role="status">{done}</div>}
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="rel-version">Version</label>
          <input id="rel-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder={newest ? `higher than ${newest}` : '0.8.0'} required disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="rel-notes">What is new (one line per change)</label>
          <textarea id="rel-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={'Fix some bugs\nFaster start-up\nBetter offline handling'} required disabled={busy} />
        </div>
        <label className="inline" style={{ gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} disabled={busy} />
          Required: no “Later” button, the window keeps coming back until it is installed
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </form>
  );
}
