'use client';

export default function ErrorPage({ error, reset }) {
  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 460 }}>
        <div className="card-pad">
          <h1>Something went wrong</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {/* Next replaces the message in production builds, so keep a useful fallback. */}
            {error?.message || 'The page could not be loaded.'}
          </p>
          <div className="notice notice-info" style={{ marginTop: 14 }}>
            If this keeps happening, check that the API is running and that{' '}
            <span className="mono">API_BASE_URL</span> points at it.
          </div>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
            <a className="btn" href="/login">
              Sign in again
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
