/**
 * The sign-in animation: one shape that bounces on a soft shadow, squashing when it lands and
 * stretching as it leaves, and between bounces flattens to a line and comes back as the next shape:
 * circle, triangle, square, and round again. Pure CSS (see .sl-* in globals.css), so it works in a
 * server component and runs without any script.
 *
 * @param {object} props
 * @param {string} [props.label]  what is happening, shown under the shape and read out to screen readers
 */
export default function ShapeLoader({ label = 'Loading' }) {
  return (
    <div className="sl" role="status" aria-live="polite">
      <div className="sl-stage" aria-hidden="true">
        <span className="sl-shadow" />
        <span className="sl-shape" />
      </div>
      <span className="sl-label">{label}…</span>
    </div>
  );
}
