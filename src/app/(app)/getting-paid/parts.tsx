import Link from "next/link";
import { tr } from "@/lib/tr";

const TABS = [
  { href: "/getting-paid", label: "Overview" },
  { href: "/getting-paid/tra", label: "TRA receipts" },
  { href: "/getting-paid/links", label: "Pay links" },
  { href: "/getting-paid/reminders", label: "Reminders" },
];

export function GetPaidTabs({ current }: { current: string }) {
  return (
    <nav className="row" style={{ gap: 8, flexWrap: "wrap", margin: "8px 0 16px" }} aria-label={tr("Getting paid")}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`btn btn-small${t.href === current ? " btn-primary" : ""}`} aria-current={t.href === current ? "page" : undefined}>
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}

/** Shown when the feature is switched off for the company. */
export function FeatureOff({ name, isManager }: { name: string; isManager: boolean }) {
  return (
    <section className="card">
      <p style={{ marginTop: 0 }}>
        {tr(name)}: {tr("switched off for this company.")}
      </p>
      {isManager ? (
        <Link className="btn btn-small" href="/settings/features">
          {tr("Switch it on in Features")}
        </Link>
      ) : (
        <p className="small muted">{tr("Management can switch it on.")}</p>
      )}
    </section>
  );
}

/** Yes / no line for "what is set up on the server". */
export function Ready({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li>
      <span className={`badge tone-${ok ? "ok" : "off"}`}>{ok ? tr("Ready") : tr("Not set up")}</span> {tr(label)}
      {!ok && hint ? <div className="small muted">{tr(hint)}</div> : null}
    </li>
  );
}
