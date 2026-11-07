import Link from "next/link";
import type { SortLink } from "@/lib/list-view";
import { tr } from "@/lib/tr";

/** A sortable table heading: a link that sorts by this column (tap again to flip), with aria-sort. */
export function SortTh({ link, className }: { link: SortLink; className?: string }) {
  const sort = link.active ? (link.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th aria-sort={sort} className={className}>
      <Link href={link.href} scroll={false} replace className="sort-th">
        {tr(link.label)}
        <span className="lsort-arrow" aria-hidden="true">
          {link.active ? (link.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );
}
