/** While the next admin page loads on the server: a calm outline of a page instead of a frozen screen. */
export default function AdminLoading() {
  return (
    <div className="adm-skeleton" aria-busy="true" aria-live="polite">
      <div className="adm-sk-stats">
        {[0, 1, 2].map((i) => (
          <span key={i} className="adm-sk adm-sk-tile" />
        ))}
      </div>
      <span className="adm-sk adm-sk-card" />
      <span className="adm-sk adm-sk-card adm-sk-short" />
    </div>
  );
}
