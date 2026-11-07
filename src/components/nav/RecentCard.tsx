"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { clearRecent, readRecent, RECENT_EVENT, type RecentItem } from "@/lib/recent-items";
import { useTr } from "@/lib/tr-client";

/** "Recently opened" on My page: the last records opened on this device. Hidden while there are none. */
export function RecentCard({ limit = 5 }: { limit?: number }) {
  const tr = useTr();
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    const update = () => setItems(readRecent());
    update();
    window.addEventListener(RECENT_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(RECENT_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <section className="card my-card nav-recent" aria-labelledby="nav-recent-h">
      <div className="my-card-head">
        <h2 id="nav-recent-h">
          <span className="my-card-icon" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          {tr("Recently opened")}
        </h2>
        <button type="button" className="nav-recent-clear small" onClick={clearRecent}>
          {tr("Clear")}
        </button>
      </div>
      <ul className="waitlist my-lines">
        {items.slice(0, limit).map((it) => (
          <li key={it.href}>
            <Link href={it.href}>
              <span>
                <strong>{it.title}</strong>
                <span>{tr(it.kind)}</span>
              </span>
              <span className="my-side" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted small nav-recent-note">{tr("Kept on this device only.")}</p>
    </section>
  );
}
