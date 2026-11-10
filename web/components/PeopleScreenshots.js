import Link from 'next/link';
import ScreenshotGrid from '@/components/ScreenshotGrid';

/**
 * Everyone's screenshots, one block per person, with paging between groups of people. Shared by the
 * Screenshots page and the Timesheet page, so they cannot drift apart.
 *
 * Nothing here loads an image: each tile stays closed until it is clicked, and the click is what is
 * recorded in the audit log (see ScreenshotGrid).
 *
 * @param {object} props
 * @param {object} props.shots     the API reply: { from, to, people, pagination }
 * @param {string} props.timezone
 * @param {number} props.page
 * @param {string} props.pageHref  the page's own address with its filters, ending in "?" or "&"; the
 *                                 page number is added to it
 */
export default function PeopleScreenshots({ shots, timezone, page, pageHref }) {
  return (
    <>
      {shots.people.length === 0 && (
        <div className="card">
          <div className="empty">No screenshots match these filters.</div>
        </div>
      )}

      {shots.people.map((p) => (
        <section key={p.employeeId} id={`shots-${p.employeeId}`} className="stack" style={{ scrollMarginTop: 16 }}>
          <div className="inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              <Link href={`/admin/employees/${p.employeeId}?from=${shots.from}&to=${shots.to}`}>{p.name}</Link>
              <span className="faint" style={{ marginLeft: 8, fontWeight: 500 }}>{p.department || 'No department'}</span>
            </h3>
            <span className="faint" style={{ fontSize: 12 }}>
              {p.shown < p.images ? `Newest ${p.shown} of ${p.images} images` : `${p.images} ${p.images === 1 ? 'image' : 'images'}`}
              {p.blurScreenshots ? ' · blurred until you click' : ''}
            </span>
          </div>
          <ScreenshotGrid items={p.items} timezone={timezone} from={shots.from} to={shots.to} blurred={p.blurScreenshots} />
        </section>
      ))}

      {shots.pagination.pages > 1 && (
        <div className="inline" style={{ justifyContent: 'center', gap: 12 }}>
          {page > 1 ? <Link className="btn" href={`${pageHref}page=${page - 1}`}>← Previous people</Link> : <span />}
          <span className="faint">Page {page} of {shots.pagination.pages}</span>
          {page < shots.pagination.pages ? <Link className="btn" href={`${pageHref}page=${page + 1}`}>Next people →</Link> : <span />}
        </div>
      )}
    </>
  );
}
