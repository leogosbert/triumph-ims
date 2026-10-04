/** Shown instantly while the next screen loads, so every tap gets a response. */
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="sk sk-pill" />
      <div className="sk sk-title" />
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
