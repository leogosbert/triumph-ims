import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { SavedReports } from "@/components/reports/SavedReports";
import { getAppContext } from "@/lib/context";
import { GROUPS } from "@/lib/reports/defs";
import { reportsFor } from "@/lib/reports/run";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await primeLang();
  const { role, features, company } = await getAppContext();
  const mine = reportsFor(role, features);
  if (mine.length === 0) redirect("/");
  return (
    <>
      <h1>{tr("Reports")}</h1>
      <p className="muted small">
        {tr("Choose a report, pick the dates and filters you want, choose the columns, then print it or download it as PDF or Excel.")}
      </p>
      <SavedReports company={company.id} />
      {GROUPS.map((g) => {
        const list = mine.filter((r) => r.group === g.key);
        if (list.length === 0) return null;
        return (
          <section key={g.key} className="rep-group">
            <h2>{tr(g.label)}</h2>
            <div className="grid grid-2">
              {list.map((r) => (
                <Link key={r.key} href={`/reports/${r.key}`} className="tile tile-icon">
                  <span className="tile-ico" aria-hidden>
                    <Icon name={g.icon} size={20} />
                  </span>
                  <span className="tile-body">
                    <span className="tile-title">{tr(r.title)}</span>
                    <span className="tile-sub">{tr(r.description)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
