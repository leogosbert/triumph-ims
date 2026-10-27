/**
 * Shown while the next screen loads, so every tap gets a response: the outline of a screen (back
 * link, title, figures, search, list). It fades in only after a short moment (globals.css), so a
 * quick screen change never flashes it.
 */
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="sk sk-pill" />
      <div className="sk sk-title" />
      <div className="sk-stats">
        {[0, 1, 2, 3].map((i) => (
          <div className="sk-stat" key={i}>
            <div className="sk sk-n" />
            <div className="sk sk-line short" />
          </div>
        ))}
      </div>
      <div className="sk sk-search" />
      <div className="sk-list">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="sk-row" key={i}>
            <div className="sk-lines">
              <div className="sk sk-line" style={{ width: `${62 - (i % 3) * 12}%` }} />
              <div className="sk sk-line short" />
            </div>
            <div className="sk sk-side" />
          </div>
        ))}
      </div>
    </div>
  );
}
