import Link from "next/link";

/** Search box, an optional filter, and a "show archived" switch for list pages. */
export function ListToolbar({
  q,
  archived,
  filter,
  addHref,
  addLabel,
}: {
  q: string;
  archived: boolean;
  filter?: { name: string; label: string; value: string; options: readonly string[] };
  addHref?: string;
  addLabel?: string;
}) {
  return (
    <form className="card toolbar" method="get" role="search">
      <div className="toolbar-row">
        <input type="search" name="q" defaultValue={q} placeholder="Search…" aria-label="Search" />
        <button className="btn" type="submit">
          Search
        </button>
      </div>
      <div className="toolbar-row small">
        {filter && (
          <select name={filter.name} defaultValue={filter.value} aria-label={filter.label}>
            <option value="">All {filter.label.toLowerCase()}</option>
            {filter.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} /> Show archived
        </label>
        {addHref && (
          <Link href={addHref} className="btn btn-primary btn-small" style={{ marginLeft: "auto" }}>
            + {addLabel}
          </Link>
        )}
      </div>
    </form>
  );
}
