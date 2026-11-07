"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SortLink } from "@/lib/list-view";
import { useTr } from "@/lib/tr-client";

/**
 * "Sort by" for a list screen. On a laptop: a row of heading-like links (tap again to flip the
 * direction). On a phone, where there is no room for headings: a select plus a direction button.
 * Sorting itself happens on the server through `?sort=` and `?dir=` (see readSort in list-view.ts).
 */
export function ListSort({ links }: { links: SortLink[] }) {
  const t = useTr();
  const router = useRouter();
  const active = links.find((l) => l.active) ?? links[0];
  if (!active) return null;
  const dirWord = (d: "asc" | "desc" | null) => (d === "asc" ? t("ascending") : t("descending"));
  return (
    <div className="lsort">
      <nav className="lsort-heads" aria-label={t("Sort by")}>
        <span className="lsort-label" aria-hidden="true">
          {t("Sort by")}
        </span>
        {links.map((l) => (
          <Link key={l.key} href={l.href} scroll={false} replace aria-current={l.active ? "true" : undefined} className="lsort-head">
            {t(l.label)}
            <span className="lsort-arrow" aria-hidden="true">
              {l.active ? (l.dir === "asc" ? "↑" : "↓") : "↕"}
            </span>
            {l.active && <span className="sr-only">{` (${t("sorted")} ${dirWord(l.dir)})`}</span>}
          </Link>
        ))}
      </nav>
      <div className="lsort-phone">
        <label>
          <span className="lsort-label">{t("Sort by")}</span>
          <select
            value={active.key}
            onChange={(e) => {
              const l = links.find((x) => x.key === e.target.value);
              if (l) router.replace(l.href, { scroll: false });
            }}
          >
            {links.map((l) => (
              <option key={l.key} value={l.key}>
                {t(l.label)}
              </option>
            ))}
          </select>
        </label>
        <Link
          href={active.href}
          scroll={false}
          replace
          className="lsort-dir"
          aria-label={`${t("Sorted")} ${dirWord(active.dir)}. ${t("Tap to reverse")}`}
        >
          <span aria-hidden="true">{active.dir === "asc" ? "↑" : "↓"}</span>
        </Link>
      </div>
    </div>
  );
}
