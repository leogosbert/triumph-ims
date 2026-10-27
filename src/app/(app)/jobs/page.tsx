import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { canInvoiceService, canPlanService, canSeeAllService, formatWhen, JOB_KINDS, JOB_PRIORITIES, JOB_STATUS, OPEN_JOB } from "@/lib/services";

export const metadata = { title: "Service jobs" };

type Job = {
  id: string;
  number: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  site: string | null;
  scheduled_for: string | null;
  due_by: string | null;
  assigned_to: string[];
  client: { name: string } | null;
};

const VIEWS: [string, string][] = [
  ["open", "Open"],
  ["mine", "Mine"],
  ["to_invoice", "To invoice"],
  ["done", "Done"],
  ["all", "All"],
];

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const { supabase, company, roles, user } = await getAppContext();
  const all = canSeeAllService(roles);
  const view = typeof sp.view === "string" && VIEWS.some(([v]) => v === sp.view) ? sp.view : all ? "open" : "mine";

  let q = supabase
    .from("service_jobs")
    .select("id, number, title, kind, priority, status, site, scheduled_for, due_by, assigned_to, client:clients(name)")
    .eq("company_id", company.id)
    .order("scheduled_for", { ascending: view === "open" || view === "mine", nullsFirst: false })
    .limit(300);
  if (view === "open") q = q.in("status", OPEN_JOB);
  if (view === "mine") q = q.contains("assigned_to", [user.id]).in("status", OPEN_JOB);
  if (view === "to_invoice") q = q.eq("status", "completed");
  if (view === "done") q = q.in("status", ["completed", "invoiced"]);
  const [{ data, error }, { data: countData }] = await Promise.all([
    q,
    supabase.from("service_jobs").select("status, due_by, scheduled_for").eq("company_id", company.id).in("status", [...OPEN_JOB, "completed"]).limit(5000),
  ]);
  if (isMissingTable(error)) return <NotReady title="Service jobs" />;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as unknown as Job[];
  const counts = (countData ?? []) as { status: string; due_by: string | null; scheduled_for: string | null }[];
  const now = Date.now();
  const late = (j: { status: string; due_by: string | null; scheduled_for: string | null }) =>
    OPEN_JOB.includes(j.status) && !!(j.due_by ?? j.scheduled_for) && Date.parse((j.due_by ?? j.scheduled_for)!) < now - (j.due_by ? 0 : 86400000);
  const names = await namesFor(supabase, jobs.flatMap((j) => j.assigned_to ?? []));
  const open = counts.filter((c) => OPEN_JOB.includes(c.status)).length;
  const inProgress = counts.filter((c) => c.status === "in_progress").length;
  const toInvoice = counts.filter((c) => c.status === "completed").length;
  const lateCount = counts.filter(late).length;

  return (
    <>
      <div className="page-head">
        <h1>{tr(all ? "Service jobs" : "My jobs")}</h1>
        {canPlanService(roles) && (
          <Link href="/jobs/new" className="btn btn-primary btn-small">
            {tr("+ Job")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Installation, repair, maintenance and inspection at client sites: who goes, what to check, materials and hours used, the client's sign-off and the invoice.")}</p>
      <Notice {...notice} />
      {all && (
        <div className="stat-grid">
          <div className="stat">
            <div className="n">{open}</div>
            <div className="l">{tr("Open jobs")}</div>
          </div>
          <div className="stat">
            <div className="n">{inProgress}</div>
            <div className="l">{tr("In progress")}</div>
          </div>
          <div className={`stat ${lateCount ? "alert" : ""}`}>
            <div className="n">{lateCount}</div>
            <div className="l">{tr("Late")}</div>
          </div>
          {canInvoiceService(roles) && (
            <div className={`stat ${toInvoice ? "alert" : ""}`}>
              <div className="n">{toInvoice}</div>
              <div className="l">{tr("Completed, not invoiced")}</div>
            </div>
          )}
        </div>
      )}
      <nav className="tabs-row" aria-label={tr("Show")}>
        {VIEWS.filter(([v]) => all || v === "mine" || v === "done" || v === "all").map(([v, label]) => (
          <Link key={v} href={`/jobs?view=${v}`} aria-current={view === v ? "page" : undefined}>
            {tr(label)}
          </Link>
        ))}
      </nav>
      {jobs.length === 0 ? (
        <p className="card muted">
          {view === "mine" ? tr("No open jobs for you. Jobs you are assigned to show here.") : tr("No jobs here.")}{" "}
          {canPlanService(roles) && view === "open" && <Link href="/jobs/new">{tr("Create the first job")}</Link>}
        </p>
      ) : (
        <ul className="rec-list">
          {jobs.map((j) => {
            const pr = JOB_PRIORITIES[j.priority];
            const who = (j.assigned_to ?? []).map((id) => names.get(id)).filter(Boolean).join(", ");
            return (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`}>
                  <div className="main">
                    <div className="title">
                      {j.title} {j.priority !== "normal" && pr && <span className={`badge tone-${pr.tone}`}>{tr(pr.label)}</span>}
                    </div>
                    <div className="sub">
                      {j.number} · {j.client?.name} · {tr(JOB_KINDS[j.kind] ?? j.kind)}
                      {j.scheduled_for && ` · ${formatWhen(j.scheduled_for)}`}
                      {who && ` · ${who}`}
                      {j.site && ` · ${j.site}`}
                    </div>
                  </div>
                  <div className="side">
                    {late(j) ? <span className="badge tone-bad">{tr("Late")}</span> : <StatusBadge map={JOB_STATUS} status={j.status} />}
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
