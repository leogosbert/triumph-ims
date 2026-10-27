import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/lib/sales";
import { CONTRACT_STATUS, FREQUENCIES, canPlanService, canSeeAllService, daysFromToday } from "@/lib/services";
import { planDueVisits } from "./actions";
import { PER_MONTH, canKeepContracts } from "./rules";

export const metadata = { title: "Maintenance contracts" };

type Row = {
  id: string;
  number: string;
  title: string;
  frequency: string;
  ends_on: string | null;
  next_visit_on: string | null;
  price: number | null;
  currency: string;
  status: string;
  created_at: string;
  client: { name: string } | null;
};

export default async function MaintenancePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canSeeAllService(roles)) redirect("/");
  const showAll = sp.view === "all";
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, number, title, frequency, ends_on, next_visit_on, price, currency, status, created_at, client:clients(name)")
    .eq("company_id", company.id)
    .order("next_visit_on", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (isMissingTable(error)) return <NotReady title="Maintenance contracts" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as Row[];
  const active = all.filter((c) => c.status === "active");
  const shown = showAll ? [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)) : active;

  const dueSoon = active.filter((c) => {
    const d = daysFromToday(c.next_visit_on);
    return d !== null && d <= 14 && (!c.ends_on || (c.next_visit_on ?? "") <= c.ends_on);
  }).length;
  const monthly = new Map<string, number>();
  for (const c of active) {
    if (c.price == null) continue;
    monthly.set(c.currency, (monthly.get(c.currency) ?? 0) + Number(c.price) * (PER_MONTH[c.frequency] ?? 0));
  }
  const monthlyText = monthly.size
    ? [...monthly.entries()].map(([cur, v]) => formatMoney(Math.round(v * 100) / 100, cur)).join(" · ")
    : formatMoney(0, company.base_currency);

  const plannedRaw = Array.isArray(sp.planned) ? sp.planned[0] : sp.planned;
  const planned = plannedRaw != null && /^\d+$/.test(plannedRaw) ? Number(plannedRaw) : null;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Maintenance contracts")}</h1>
        {canKeepContracts(roles) && (
          <Link href="/maintenance/new" className="btn btn-primary btn-small">
            {tr("+ Contract")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Regular service visits you have agreed with clients. Plan the due visits and LeMoSp creates the jobs.")}</p>
      <Notice {...notice} />
      {planned !== null && (
        <p className={planned > 0 ? "banner small ok" : "card muted small"}>
          {planned > 0 ? (
            <>
              {tr("Jobs created for due visits:")} <strong>{planned}</strong> · <Link href="/jobs">{tr("Open jobs")}</Link>
            </>
          ) : (
            tr("No new jobs: no visits are due in the next 14 days, or their jobs already exist.")
          )}
        </p>
      )}
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{active.length}</div>
          <div className="l">{tr("Active contracts")}</div>
        </div>
        <div className={`stat ${dueSoon ? "alert" : ""}`}>
          <div className="n">{dueSoon}</div>
          <div className="l">{tr("Visits due in the next 14 days")}</div>
        </div>
        <div className="stat">
          <div className="n">{monthlyText}</div>
          <div className="l">{tr("Contract value per month")}</div>
        </div>
      </div>
      {canPlanService(roles) && (
        <form action={planDueVisits} className="actions-bar">
          <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Planning…")}>
            {tr("Plan due visits")}
          </SubmitButton>
          <span className="muted small">{tr("Creates a job for every visit due in the next 14 days.")}</span>
        </form>
      )}
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/maintenance" aria-current={!showAll ? "page" : undefined}>
          {tr("Active")}
        </Link>
        <Link href="/maintenance?view=all" aria-current={showAll ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {shown.length === 0 ? (
        <p className="card muted">
          {showAll || all.length === 0
            ? tr("No maintenance contracts yet. Add one for each client you service regularly.")
            : tr("No active contracts.")}
        </p>
      ) : (
        <ul className="rec-list">
          {shown.map((c) => {
            const d = c.status === "active" ? daysFromToday(c.next_visit_on) : null;
            return (
              <li key={c.id}>
                <Link href={`/maintenance/${c.id}`}>
                  <div className="main">
                    <div className="title">
                      {c.client?.name ?? "—"} <span className="muted">· {c.title}</span>
                    </div>
                    <div className="sub">
                      {c.number} · {tr(FREQUENCIES[c.frequency] ?? c.frequency)}
                      {c.price != null && ` · ${formatMoney(c.price, c.currency)}`}
                      {c.status === "active" && c.next_visit_on && ` · ${tr("Next visit")} ${formatDate(c.next_visit_on)}`}
                    </div>
                  </div>
                  <div className="side">
                    {d !== null && d <= 14 ? (
                      <span className={`badge ${d < 0 ? "tone-bad" : "tone-warn"}`}>{d < 0 ? tr("Visit overdue") : tr("Visit due")}</span>
                    ) : (
                      <StatusBadge map={CONTRACT_STATUS} status={c.status} />
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
