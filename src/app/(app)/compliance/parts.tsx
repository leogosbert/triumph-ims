import Link from "next/link";
import { tr } from "@/lib/tr";
import { CATALOGUE_REVIEWED_ON, COMPLIANCE_DISCLAIMER, type Requirement } from "@/lib/compliance/catalogue";
import { formatDate } from "@/lib/format";

const TABS = [
  { href: "/compliance", label: "Overview" },
  { href: "/compliance/checklist", label: "Checklist" },
  { href: "/compliance/licences", label: "Licences" },
  { href: "/compliance/calendar", label: "Tax & filing calendar" },
  { href: "/compliance/directors", label: "Directors & shares" },
  { href: "/compliance/guide", label: "What do I need?" },
] as const;

/** The tabs of the Legal & compliance area. */
export function ComplianceTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="tabs-row" aria-label={tr("Legal & compliance")}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}

/** "Guidance, not legal advice", with the date the catalogue was last reviewed. */
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`small muted${compact ? "" : " card"}`} style={compact ? undefined : { marginTop: 16 }}>
      <strong>{tr("Guidance, not legal advice.")}</strong> {tr(COMPLIANCE_DISCLAIMER)} {tr("Last reviewed")} {formatDate(CATALOGUE_REVIEWED_ON)}.
    </p>
  );
}

/** What the catalogue says about one requirement (item page, guide). */
export function RequirementFacts({ r, open = false }: { r: Requirement; open?: boolean }) {
  return (
    <div className="small">
      <p style={{ margin: "4px 0" }}>{tr(r.purpose)}</p>
      {r.condition && (
        <p style={{ margin: "4px 0" }}>
          <strong>{tr("When it applies")}:</strong> {tr(r.condition)}
        </p>
      )}
      <p style={{ margin: "4px 0" }}>
        <strong>{tr("Who")}:</strong> {tr(r.authority)}
        {r.website && (
          <>
            {" · "}
            <a href={r.website} target="_blank" rel="noopener noreferrer">
              {r.website.replace(/^https:\/\/(www\.)?/, "")}
            </a>
          </>
        )}
      </p>
      <p style={{ margin: "4px 0" }}>
        <strong>{tr("When")}:</strong> {tr(r.dueRule)} {tr(r.renewal)}
      </p>
      <details open={open}>
        <summary>{tr("Documents usually needed")}</summary>
        <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
          {r.documentsNeeded.map((d) => (
            <li key={d}>{tr(d)}</li>
          ))}
        </ul>
      </details>
      <p style={{ margin: "4px 0" }}>
        <strong>{tr("Risk if missed")}:</strong> {tr(r.penalty)}
      </p>
      {r.verify && (
        <p className="banner warn small" style={{ margin: "6px 0", padding: "8px 10px" }}>
          {tr("Check before you rely on it")}: {tr(r.verifyNote ?? "Confirm the details with the authority.")}
        </p>
      )}
    </div>
  );
}
