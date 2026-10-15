import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { INVOICE_STATUS } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { companyPeople, namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { canInvoiceService, MILESTONE_STATUS, PROJECT_BILLING, PROJECT_STATUS, todayTz } from "@/lib/services";
import { addMilestone, invoiceProject, markMilestone, removeMilestone, saveProject, setProjectStatus } from "../actions";
import { canKeepProjects, hoursText, invoicedTotal, type Entry, type InvoiceRow, type Milestone, type Project } from "../projectData";
import { ProjectFields } from "../ProjectFields";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const { data, error } = await supabase
    .from("projects")
    .select("*, client:clients(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Project" />;
  if (error) throw new Error(error.message);
  if (!data) notFound();
  const project = data as unknown as Project & { client: { name: string } | null };
  const keeper = canKeepProjects(role);
  const invoicer = canInvoiceService(role);
  const cur = project.currency;

  const [{ data: msData }, { data: tsData }, people] = await Promise.all([
    supabase.from("project_milestones").select("id, title, due_on, amount, status, invoice_id, sort").eq("project_id", id).order("sort").order("due_on"),
    supabase
      .from("timesheets")
      .select("id, user_id, work_date, hours, billable, rate, invoice_id, description")
      .eq("project_id", id)
      .order("work_date", { ascending: false })
      .limit(5000),
    keeper ? companyPeople(supabase, company.id) : Promise.resolve([]),
  ]);
  const milestones = (msData ?? []) as Milestone[];
  const entries = (tsData ?? []) as Entry[];
  const invoiceIds = [...new Set([...milestones.map((m) => m.invoice_id), ...entries.map((e) => e.invoice_id)].filter((x): x is string => !!x))];
  const [{ data: invData }, names] = await Promise.all([
    invoiceIds.length
      ? supabase.from("invoices").select("id, number, status, total, currency").in("id", invoiceIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    namesFor(supabase, [project.manager_id, ...entries.map((e) => e.user_id)]),
  ]);
  const invoices = (invData ?? []) as InvoiceRow[];

  const hoursUsed = entries.reduce((s, e) => s + Number(e.hours), 0);
  const unbilled = entries.filter((e) => e.billable && !e.invoice_id);
  const unbilledValue = unbilled.reduce((s, e) => s + Number(e.hours) * Number(e.rate ?? 0), 0);
  const unbilledHours = unbilled.reduce((s, e) => s + Number(e.hours), 0);
  const noRate = unbilled.filter((e) => !Number(e.rate)).length;
  const invoiced = invoicedTotal(invoices);
  const budgetHours = project.budget_hours != null ? Number(project.budget_hours) : null;
  const toInvoice = milestones.filter((m) => m.status !== "invoiced");

  // Hours grouped by person.
  const byPerson = new Map<string, Entry[]>();
  for (const e of entries) byPerson.set(e.user_id, [...(byPerson.get(e.user_id) ?? []), e]);
  const groups = [...byPerson.entries()]
    .map(([uid, list]) => ({
      uid,
      name: names.get(uid) ?? tr("Former member"),
      list,
      hours: list.reduce((s, e) => s + Number(e.hours), 0),
      billable: list.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0),
      value: list.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours) * Number(e.rate ?? 0), 0),
    }))
    .sort((a, b) => b.hours - a.hours);

  return (
    <>
      <p className="small">
        <Link href="/projects">{tr("← Projects")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{project.name}</h1>
        <StatusBadge map={PROJECT_STATUS} status={project.status} />
      </div>
      <p className="muted small">
        {project.number} · {project.client?.name} · {tr(PROJECT_BILLING[project.billing] ?? project.billing)}
        {project.default_rate != null && ` · ${formatMoney(project.default_rate, cur)} ${tr("per hour")}`}
        {project.manager_id && names.get(project.manager_id) && ` · ${tr("Manager")}: ${names.get(project.manager_id)}`}
        {(project.starts_on || project.ends_on) &&
          ` · ${project.starts_on ? formatDate(project.starts_on) : "…"} – ${project.ends_on ? formatDate(project.ends_on) : "…"}`}
      </p>
      {project.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{project.description}</p>}
      <Notice {...notice} />

      <div className="stat-grid">
        <div className={`stat ${budgetHours != null && budgetHours > 0 && hoursUsed > budgetHours ? "alert" : ""}`}>
          <div className="n">
            {hoursText(hoursUsed)}
            {budgetHours != null && <span className="muted small"> / {hoursText(budgetHours)}</span>}
          </div>
          <div className="l">{budgetHours != null ? tr("Hours used of the budget") : tr("Hours used")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(unbilledValue, cur)}</div>
          <div className="l">
            {tr("Billable hours not yet invoiced")} · {hoursText(unbilledHours)} h
          </div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(invoiced, cur)}</div>
          <div className="l">
            {tr("Invoiced")}
            {project.budget_amount != null && ` · ${tr("budget")} ${formatMoney(project.budget_amount, cur)}`}
          </div>
        </div>
      </div>
      {!invoicer && <p className="muted small">{tr("Hours show only what you can see: your own hours.")}</p>}
      {noRate > 0 && invoicer && (
        <p className="banner warn small">
          {noRate} {tr("billable entries have no rate and will not be invoiced. Set the person's rate or the project's hourly rate.")}{" "}
          <Link href="/timesheets/rates">{tr("Rates")}</Link>
        </p>
      )}

      {keeper && project.status !== "active" && (
        <form action={setProjectStatus} className="actions-bar">
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="status" value="active" />
          <SubmitButton className="btn btn-small">{tr("Make active again")}</SubmitButton>
        </form>
      )}
      {keeper && project.status === "active" && (
        <div className="actions-bar">
          {(["on_hold", "completed", "cancelled"] as const).map((s) => (
            <form key={s} action={setProjectStatus}>
              <input type="hidden" name="id" value={project.id} />
              <input type="hidden" name="status" value={s} />
              <SubmitButton className="btn btn-small">
                {s === "on_hold" ? tr("Put on hold") : s === "completed" ? tr("Mark completed") : tr("Cancel project")}
              </SubmitButton>
            </form>
          ))}
        </div>
      )}

      <section className="card" id="milestones">
        <h2>{tr("Milestones")}</h2>
        {milestones.length === 0 ? (
          <p className="muted small">{tr("No milestones yet.")}</p>
        ) : (
          <ul className="lines">
            {milestones.map((m) => (
              <li key={m.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{m.title}</div>
                    <div className="muted small">
                      {m.due_on ? `${tr("Due")} ${formatDate(m.due_on)}` : tr("No due date")}
                      {m.invoice_id && (
                        <>
                          {" · "}
                          <Link href={`/invoices/${m.invoice_id}`}>{tr("Invoice")}</Link>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong style={{ whiteSpace: "nowrap" }}>{m.amount != null ? formatMoney(m.amount, cur) : "—"}</strong>
                    <div>
                      <StatusBadge map={MILESTONE_STATUS} status={m.status} />
                    </div>
                  </div>
                </div>
                {keeper && m.status !== "invoiced" && (
                  <div className="actions">
                    <form action={markMilestone}>
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="milestone_id" value={m.id} />
                      <input type="hidden" name="status" value={m.status === "open" ? "done" : "open"} />
                      <SubmitButton className="btn btn-small">{m.status === "open" ? tr("Mark done") : tr("Open again")}</SubmitButton>
                    </form>
                    {m.status === "open" && (
                      <form action={removeMilestone}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="milestone_id" value={m.id} />
                        <SubmitButton className="btn btn-small">{tr("Remove")}</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {keeper && (
          <details>
            <summary className="btn btn-small">{tr("+ Milestone")}</summary>
            <form action={addMilestone}>
              <input type="hidden" name="project_id" value={project.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="ms-title">{tr("What is delivered")}</label>
                  <input id="ms-title" name="title" type="text" required minLength={2} maxLength={200} placeholder={tr("e.g. Survey report")} />
                </div>
                <div className="field">
                  <label htmlFor="ms-due">{tr("Due on")}</label>
                  <input id="ms-due" name="due_on" type="date" />
                </div>
                <div className="field">
                  <label htmlFor="ms-amount">
                    {tr("Amount")} ({cur})
                  </label>
                  <input id="ms-amount" name="amount" type="text" inputMode="decimal" />
                </div>
              </div>
              <SubmitButton className="btn btn-small btn-primary">{tr("Add milestone")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {invoicer && (
        <form action={invoiceProject} className="card" id="invoice">
          <h2>{tr("Invoice the client")}</h2>
          <input type="hidden" name="project_id" value={project.id} />
          {toInvoice.length > 0 && (
            <>
              <p className="small">{tr("Milestones to invoice")}</p>
              {toInvoice.map((m) => (
                <label key={m.id} className="check">
                  <input type="checkbox" name="milestones" value={m.id} defaultChecked={m.status === "done" && Number(m.amount) > 0} /> {m.title} ·{" "}
                  {m.amount != null ? formatMoney(m.amount, cur) : tr("no amount")}
                </label>
              ))}
            </>
          )}
          <div className="field">
            <label htmlFor="hours_until">{tr("Invoice billable hours up to")}</label>
            <input id="hours_until" name="hours_until" type="date" max={todayTz()} defaultValue={project.billing === "time" ? todayTz() : ""} />
            <p className="hint">{tr("Leave empty to invoice milestones only.")}</p>
          </div>
          <SubmitButton pendingText={tr("Making the invoice…")}>{tr("Make draft invoice")}</SubmitButton>
        </form>
      )}

      {invoices.length > 0 && (
        <section className="card">
          <h2>{tr("Invoices")}</h2>
          <ul className="rec-list">
            {invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`}>
                  <div className="main">
                    <div className="title">{i.number || tr("Draft")}</div>
                  </div>
                  <div className="side">
                    <strong>{formatMoney(i.total, i.currency)}</strong> <StatusBadge map={INVOICE_STATUS} status={i.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="hours">
        <h2>{tr("Hours by person")}</h2>
        {groups.length === 0 ? (
          <p className="muted small">
            {tr("No hours recorded yet.")} <Link href="/timesheets">{tr("Record hours")}</Link>
          </p>
        ) : (
          <ul className="lines">
            {groups.map((g) => (
              <li key={g.uid}>
                <details>
                  <summary>
                    <span className="line-head" style={{ display: "inline-flex", width: "calc(100% - 24px)" }}>
                      <span className="desc">{g.name}</span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {hoursText(g.hours)} h{invoicer && g.value > 0 && ` · ${formatMoney(g.value, cur)}`}
                      </span>
                    </span>
                  </summary>
                  <p className="muted small">
                    {tr("Billable")} {hoursText(g.billable)} h · {tr("Not billable")} {hoursText(g.hours - g.billable)} h
                  </p>
                  <ul className="lines">
                    {g.list.slice(0, 100).map((e) => (
                      <li key={e.id} className="small">
                        <div className="line-head">
                          <span>
                            {formatDate(e.work_date)}
                            {e.description && ` · ${e.description}`}
                            {!e.billable && <span className="muted"> · {tr("not billable")}</span>}
                            {e.invoice_id && <span className="muted"> · {tr("invoiced")}</span>}
                          </span>
                          <strong style={{ whiteSpace: "nowrap" }}>{hoursText(Number(e.hours))} h</strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {keeper && (
        <details className="card">
          <summary>{tr("Edit project")}</summary>
          <form action={saveProject}>
            <input type="hidden" name="id" value={project.id} />
            <ProjectFields p={project} clients={[]} people={people} currency={cur} editing />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
