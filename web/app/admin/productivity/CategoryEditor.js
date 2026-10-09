'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

const OPTIONS = [
  { value: 'productive', label: 'Productive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'distracting', label: 'Distracting' },
];

/**
 * Lets an admin decide how each app counts towards the score. Rows show the effective category
 * (a built-in default unless overridden); "Reset" drops the override.
 */
export default function CategoryEditor({ apps }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [newApp, setNewApp] = useState('');
  const [newCategory, setNewCategory] = useState('productive');

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const setCategory = (appName, category) =>
    run(appName, () =>
      call('/api/admin/app-categories', { method: 'PATCH', body: { appName, category } })
    );

  const reset = (appName) =>
    run(appName, () =>
      call(`/api/admin/app-categories?${new URLSearchParams({ appName })}`, { method: 'DELETE' })
    );

  async function add(e) {
    e.preventDefault();
    const name = newApp.trim();
    if (!name) return;
    await run('new', async () => {
      await call('/api/admin/app-categories', {
        method: 'PATCH',
        body: { appName: name, category: newCategory },
      });
      setNewApp('');
    });
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>App categories</h2>
        <span className="faint">decides how each app counts towards the score</span>
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="notice notice-danger" role="alert">{error}</div>}

        <form onSubmit={add} className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
            placeholder="App name, e.g. Notepad"
            aria-label="App name"
            disabled={busy !== null}
            style={{ maxWidth: 240 }}
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            aria-label="Category"
            disabled={busy !== null}
          >
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={busy !== null || !newApp.trim()}>
            Add
          </button>
        </form>

        {apps.length === 0 ? (
          <div className="empty">No apps seen yet. They appear once the desktop agent reports them.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Samples (30d)</th>
                  <th>Category</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.appKey}>
                    <td>
                      <i className={`dot ${a.category}`} />
                      {a.appName}
                    </td>
                    <td className="num muted">{a.samples}</td>
                    <td>
                      <select
                        value={a.category}
                        onChange={(e) => setCategory(a.appName, e.target.value)}
                        disabled={busy !== null}
                        aria-label={`Category for ${a.appName}`}
                      >
                        {OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {a.overridden ? (
                        <button type="button" className="btn" disabled={busy !== null} onClick={() => reset(a.appName)}>
                          Reset
                        </button>
                      ) : (
                        <span className="faint">default</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
