/**
 * The loading animation: a round glass that fills with water and drains again, the surface rolling
 * as it goes. Pure CSS (see .wl-* in globals.css), so it needs no script, works in a server
 * component, and costs nothing while nothing is loading.
 *
 * @param {object} props
 * @param {string} [props.label]  what is happening, shown under the glass and read out to screen readers
 * @param {number} [props.size]   diameter in pixels
 */
export default function WaveLoader({ label = 'Loading', size = 132 }) {
  return (
    <div className="wl" role="status" aria-live="polite" style={{ '--wl-size': `${size}px` }}>
      <div className="wl-circle" aria-hidden="true">
        <div className="wl-wave" />
      </div>
      <span className="wl-label">{label}…</span>
    </div>
  );
}
