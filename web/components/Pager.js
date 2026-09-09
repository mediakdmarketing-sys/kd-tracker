import Link from 'next/link';

/** Server-rendered pagination: page state lives in the URL, not in component state. */
export default function Pager({ pagination, searchParams, basePath }) {
  const { page, totalPages, total } = pagination;
  if (total === 0) return null;

  const linkFor = (target) => {
    const next = new URLSearchParams(
      Object.entries(searchParams || {}).filter(([, v]) => v !== undefined && v !== '')
    );
    next.set('page', String(target));
    return `${basePath}?${next.toString()}`;
  };

  return (
    <div className="row-between" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
      <span className="faint">
        Page {page} of {totalPages} · {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="btn-row">
        {page > 1 ? (
          <Link className="btn" href={linkFor(page - 1)}>
            ← Previous
          </Link>
        ) : (
          <button className="btn" disabled>
            ← Previous
          </button>
        )}
        {page < totalPages ? (
          <Link className="btn" href={linkFor(page + 1)}>
            Next →
          </Link>
        ) : (
          <button className="btn" disabled>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
