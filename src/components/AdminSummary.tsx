import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { num, type AdminSummary as Summary } from "@/lib/hr";
import { tr } from "@/lib/tr";

type Item = { n: number; label: string; href: string; tone?: "bad" | "warn" };

/**
 * "Administration" on the home screen: leave and timesheets waiting, open incidents,
 * overdue actions, NCRs and certificates for management; a person's own items for everyone else.
 * Hidden when there is nothing to show, when the features are off or before the SQL is run.
 */
export async function AdminSummary() {
  try {
    const { supabase, company, features } = await getAppContext();
    const on = {
      hr: features.on("hr_people"),
      hse: features.on("hse"),
      quality: features.on("quality"),
      ts: features.on("timesheet_approval"),
    };
    if (!on.hr && !on.hse && !on.quality && !on.ts) return null;
    const { data, error } = await supabase.rpc("admin_summary", { p_company: company.id });
    if (error || !data || typeof data !== "object") return null;
    const s = data as Summary;

    let items: Item[];
    if (s.manager) {
      const serious = num(s.incidents_serious_open);
      items = [
        { n: num(s.leave_waiting), label: "Leave waiting", href: "/hr/leave", show: on.hr },
        { n: num(s.weeks_waiting), label: "Timesheets waiting", href: "/timesheets/approve", show: on.ts },
        { n: num(s.incidents_open), label: serious ? `Open incidents (${serious} serious)` : "Open incidents", href: "/hse", show: on.hse, tone: serious ? ("bad" as const) : undefined },
        { n: num(s.actions_overdue), label: "Overdue actions", href: "/hse", show: on.hse || on.quality, tone: "warn" as const },
        { n: num(s.ncrs_open), label: "Open NCRs", href: "/quality", show: on.quality },
        { n: num(s.certs_expired) + num(s.certs_expiring), label: "Certificates expired or expiring", href: "/hr", show: on.hr, tone: num(s.certs_expired) ? ("bad" as const) : ("warn" as const) },
      ]
        .filter((i) => i.show && i.n > 0)
        .map(({ show: _show, ...i }) => i);
    } else {
      const overdue = num(s.my_actions_overdue);
      items = [
        { n: num(s.my_actions), label: overdue ? `My actions (${overdue} overdue)` : "My actions", href: "/hse", show: on.hse || on.quality, tone: overdue ? ("bad" as const) : undefined },
        { n: num(s.my_week_returned), label: "Timesheet sent back", href: "/timesheets", show: on.ts, tone: "warn" as const },
        { n: num(s.my_certs_expiring), label: "My certificates expiring", href: "/hr", show: on.hr, tone: "warn" as const },
      ]
        .filter((i) => i.show && i.n > 0)
        .map(({ show: _show, ...i }) => i);
    }
    if (items.length === 0) return null;

    return (
      <section className="card">
        <h2>{tr("Administration")}</h2>
        <ul className="lines">
          {items.map((i) => (
            <li key={i.label}>
              <Link href={i.href} className="line-head" style={{ color: "inherit", textDecoration: "none", alignItems: "center" }}>
                <span>{trCount(i.label)}</span>
                <span className={`badge tone-${i.tone ?? "info"}`}>{i.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } catch {
    // Never break the home screen.
    return null;
  }
}

/** "Open incidents (2 serious)": translate the words, keep the number. */
function trCount(label: string): string {
  const m = /^(.*) \((\d+) (serious|overdue)\)$/.exec(label);
  if (!m) return tr(label);
  return `${tr(m[1])} (${m[2]} ${tr(m[3])})`;
}
