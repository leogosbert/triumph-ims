import { tr } from "@/lib/tr";
import Link from "next/link";
import { ScanButton } from "@/components/ScanButton";

/** Search box, an optional filter, and a "show archived" switch for list pages. */
export function ListToolbar({
  q,
  archived,
  filter,
  addHref,
  addLabel,
  scan = false,
  keep,
}: {
  q: string;
  archived: boolean;
  filter?: { name: string; label: string; value: string; options: readonly string[] };
  addHref?: string;
  addLabel?: string;
  /** A camera Scan button beside the search box (product lists), where the phone can read barcodes. */
  scan?: boolean;
  /** Other params to keep when searching, for example a chosen sort ({ sort: "price", dir: "asc" }). */
  keep?: Record<string, string>;
}) {
  return (
    <form className="card toolbar" method="get" role="search">
      {keep && Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="toolbar-row">
        <input id={scan ? "list-q" : undefined} type="search" name="q" defaultValue={q} placeholder={tr("Search…")} aria-label={tr("Search")} enterKeyHint="search" />
        {scan && <ScanButton target="list-q" submit />}
        <button className="btn" type="submit">{tr("Search")}</button>
      </div>
      <div className="toolbar-row small">
        {filter && (
          <select name={filter.name} defaultValue={filter.value} aria-label={filter.label}>
            <option value="">{tr("All")}{" "}{filter.label.toLowerCase()}</option>
            {filter.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />{" "}{tr("Show archived")}</label>
        {addHref && (
          <Link href={addHref} className="btn btn-primary btn-small" style={{ marginLeft: "auto" }}>
            + {addLabel}
          </Link>
        )}
      </div>
    </form>
  );
}
