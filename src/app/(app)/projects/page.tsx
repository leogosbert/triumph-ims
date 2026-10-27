import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { chunk } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/lib/sales";
import { canInvoiceService, PROJECT_BILLING, PROJECT_STATUS } from "@/lib/services";
import { canKeepProjects, hoursText, invoicedTotal, type InvoiceRow, type Project } from "./projectData";

export const metadata = { title: "Projects" };

type Row = Project & { client: { name: string } | null };

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  const showAll = sp.view === "all";
  let q = supabase
    .from("projects")
    .select("id, number, client_id, name, description, billing, budget_amount, budget_hours, default_rate, currency, starts_on, ends_on, manager_id, status, client:clients(name)")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (!showAll) q = q.in("status", ["active", "on_hold"]);
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Projects" />;
  if (error) throw new Error(error.message);
  const projects = (data ?? []) as unknown as Row[];
  const ids = projects.map((p) => p.id);

  // Hours and invoices per project.
  const hours = new Map<string, number>();
  const invoiceOf = new Map<string, Set<string>>();
  const link = (projectId: string, invoiceId: string | null) => {
    if (!invoiceId) return;
    if (!invoiceOf.has(projectId)) invoiceOf.set(projectId, new Set());
    invoiceOf.get(projectId)!.add(invoiceId);
  };
  for (const part of chunk(ids)) {
    const [{ data: ts }, { data: ms }] = await Promise.all([
      supabase.from("timesheets").select("project_id, hours, invoice_id").in("project_id", part).limit(20000),
      supabase.from("project_milestones").select("project_id, invoice_id").in("project_id", part).not("invoice_id", "is", null),
    ]);
    for (const t of (ts ?? []) as { project_id: string; hours: number; invoice_id: string | null }[]) {
      hours.set(t.project_id, (hours.get(t.project_id) ?? 0) + Number(t.hours));
      link(t.project_id, t.invoice_id);
    }
    for (const m of (ms ?? []) as { project_id: string; invoice_id: string | null }[]) link(m.project_id, m.invoice_id);
  }
  const allInvoiceIds = [...new Set([...invoiceOf.values()].flatMap((s) => [...s]))];
  const invoices = new Map<string, InvoiceRow>();
  for (const part of chunk(allInvoiceIds)) {
    const { data: inv } = await supabase.from("invoices").select("id, number, status, total, currency").in("id", part);
    for (const i of (inv ?? []) as InvoiceRow[]) invoices.set(i.id, i);
  }
  const invoicedFor = (id: string) =>
    invoicedTotal([...(invoiceOf.get(id) ?? [])].map((i) => invoices.get(i)).filter((i): i is InvoiceRow => !!i));

  return (
    <>
      <div className="page-head">
        <h1>{tr("Projects")}</h1>
        {canKeepProjects(roles) && (
          <Link href="/projects/new" className="btn btn-primary btn-small">
            {tr("+ Project")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Consulting and installation projects with their budget, milestones, hours and invoices.")}</p>
      {!canInvoiceService(roles) && <p className="muted small">{tr("Hours show only what you can see: your own hours.")}</p>}
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/projects" aria-current={!showAll ? "page" : undefined}>
          {tr("Active")}
        </Link>
        <Link href="/projects?view=all" aria-current={showAll ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {projects.length === 0 ? (
        <p className="card muted">{tr("No projects yet. Add a project to record hours and milestones against it and invoice the client.")}</p>
      ) : (
        <ul className="rec-list">
          {projects.map((p) => {
            const h = hours.get(p.id) ?? 0;
            const over = p.budget_hours != null && Number(p.budget_hours) > 0 && h > Number(p.budget_hours);
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`}>
                  <div className="main">
                    <div className="title">
                      {p.name} <span className="muted">· {p.number}</span>
                    </div>
                    <div className="sub">
                      {p.client?.name} · {tr(PROJECT_BILLING[p.billing] ?? p.billing)}
                    </div>
                    <div className="sub">
                      <span style={over ? { color: "var(--err)", fontWeight: 600 } : undefined}>
                        {hoursText(h)}
                        {p.budget_hours != null ? ` / ${hoursText(Number(p.budget_hours))}` : ""} {tr("hours")}
                      </span>
                      {" · "}
                      {tr("Invoiced")} {formatMoney(invoicedFor(p.id), p.currency)}
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={PROJECT_STATUS} status={p.status} />
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
