import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { canSeeCompliance, num, type ComplianceSummary } from "@/lib/compliance/model";
import { formatDate } from "@/lib/format";
import { tr } from "@/lib/tr";

/**
 * "Legal & compliance" on the home screen: overdue and due filings, licences expiring, copies missing and the next
 * filing. Hidden for drivers, when the feature is off, before the SQL is run, and when there is nothing to say.
 */
export async function ComplianceCard() {
  try {
    const { supabase, company, role, features } = await getAppContext();
    if (!canSeeCompliance(role) || !features.on("compliance")) return null;
    const { data, error } = await supabase.rpc("compliance_summary", { p_company: company.id });
    if (error || !data || typeof data !== "object") return null;
    const s = data as ComplianceSummary;
    if (!s.ready) return null;

    if (!s.set_up) {
      if (!s.can_manage) return null;
      return (
        <section className="card">
          <h2>{tr("Legal & compliance")}</h2>
          <p className="small">{tr("Set up the list of registrations, licences and tax filings the company needs, and get reminders before each one is due.")}</p>
          <Link href="/compliance/checklist/adopt" className="btn btn-small btn-primary">
            {tr("Set up my checklist")}
          </Link>
        </section>
      );
    }

    const items = [
      { n: num(s.overdue), label: "Overdue filings and items", href: "/compliance/calendar", tone: "bad" },
      { n: num(s.due_soon), label: "Due in the next 14 days", href: "/compliance/calendar", tone: "warn" },
      { n: num(s.licences_expired), label: "Licences expired", href: "/compliance/licences?status=expired", tone: "bad" },
      { n: num(s.licences_expiring), label: "Licences expiring", href: "/compliance/licences?status=expiring", tone: "warn" },
      { n: num(s.missing_docs), label: "Done but no copy uploaded", href: "/compliance/checklist?show=nocopy", tone: "info" },
    ].filter((i) => i.n > 0);
    const next = s.next_filings?.[0];
    if (items.length === 0 && !next) return null;

    return (
      <section className="card">
        <div className="line-head" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>{tr("Legal & compliance")}</h2>
          <Link href="/compliance" className="small">
            {num(s.score)}% {tr("done")} →
          </Link>
        </div>
        <ul className="lines" style={{ marginTop: 8 }}>
          {items.map((i) => (
            <li key={i.label}>
              <Link href={i.href} className="line-head" style={{ color: "inherit", textDecoration: "none", alignItems: "center" }}>
                <span>{tr(i.label)}</span>
                <span className={`badge tone-${i.tone}`}>{i.n}</span>
              </Link>
            </li>
          ))}
          {next && (
            <li>
              <Link href="/compliance/calendar" className="line-head" style={{ color: "inherit", textDecoration: "none", alignItems: "center" }}>
                <span>
                  {tr("Next")}: {tr(next.name)} <span className="small muted">· {next.period}</span>
                </span>
                <span className="small">{formatDate(next.due_on)}</span>
              </Link>
            </li>
          )}
        </ul>
        {!s.shares_decided && s.can_manage && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            <Link href="/compliance/directors">{tr("Shares not yet decided.")}</Link>
          </p>
        )}
      </section>
    );
  } catch {
    // Never break the home screen.
    return null;
  }
}
