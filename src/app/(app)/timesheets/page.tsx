import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { clientOptions } from "@/lib/options";
import { namesFor } from "@/lib/people";
import { canInvoiceService, OPEN_JOB, todayTz } from "@/lib/services";
import { can } from "@/lib/roles";
import { addHours, removeHours, submitWeek } from "./actions";
import { addDays, hoursText, mondayOf } from "./week";

export const metadata = { title: "Timesheets" };

type Line = {
  id: string;
  user_id: string;
  work_date: string;
  hours: number;
  billable: boolean;
  rate: number | null;
  cost_rate: number | null;
  invoice_id: string | null;
  description: string | null;
  project: { number: string; name: string } | null;
  job: { number: string; title: string } | null;
  client: { name: string } | null;
};

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function what(l: Line): string {
  if (l.job) return `${l.job.number} · ${l.job.title}`;
  if (l.project) return `${l.project.number} · ${l.project.name}`;
  if (l.client) return l.client.name;
  return tr("Internal work");
}

export default async function TimesheetsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user, features } = await getAppContext();
  const manager = canInvoiceService(role);
  const team = manager && pick(sp.view) === "team";
  const week = mondayOf(pick(sp.week));
  const sunday = addDays(week, 6);
  const today = todayTz();
  const thisWeek = mondayOf(today);
  const base = company.base_currency;

  let q = supabase
    .from("timesheets")
    .select("id, user_id, work_date, hours, billable, rate, cost_rate, invoice_id, description, project:projects(number, name), job:service_jobs(number, title), client:clients(name)")
    .eq("company_id", company.id)
    .gte("work_date", week)
    .lte("work_date", sunday)
    .order("work_date")
    .order("created_at")
    .limit(5000);
  if (!team) q = q.eq("user_id", user.id);
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Timesheets" />;
  if (error) throw new Error(error.message);
  const lines = (data ?? []) as unknown as Line[];
  const total = lines.reduce((s, l) => s + Number(l.hours), 0);
  const billable = lines.filter((l) => l.billable).reduce((s, l) => s + Number(l.hours), 0);
  const value = lines.filter((l) => l.billable).reduce((s, l) => s + Number(l.hours) * Number(l.rate ?? 0), 0);

  // Timesheet approval: the status of this week for the signed-in person (quiet before that SQL is run).
  type WeekRow = { status: "submitted" | "approved" | "returned"; note: string | null; hours: number };
  const weekRes = features.on("timesheet_approval")
    ? await supabase
        .from("timesheet_weeks")
        .select("status, note, hours")
        .eq("company_id", company.id)
        .eq("user_id", user.id)
        .eq("week_start", week)
        .maybeSingle()
    : null;
  const approval = Boolean(weekRes && !weekRes.error);
  const weekRow = approval ? ((weekRes?.data ?? null) as WeekRow | null) : null;
  const locked = weekRow?.status === "submitted" || weekRow?.status === "approved";

  const viewQ = team ? "&view=team" : "";
  const weekLink = (w: string) => `/timesheets?week=${w}${viewQ}`;

  const head = (
    <>
      <div className="page-head">
        <h1>{tr("Timesheets")}</h1>
        {manager && (
          <span style={{ display: "flex", gap: 6 }}>
            {approval && can(role, "manageHr") && (
              <Link href="/timesheets/approve" className="btn btn-small">
                {tr("Approve weeks")}
              </Link>
            )}
            <Link href="/timesheets/rates" className="btn btn-small">
              {tr("Rates")}
            </Link>
          </span>
        )}
      </div>
      <Notice {...notice} />
      {manager && (
        <nav className="tabs-row" aria-label={tr("Show")}>
          <Link href={`/timesheets?week=${week}`} aria-current={!team ? "page" : undefined}>
            {tr("My hours")}
          </Link>
          <Link href={`/timesheets?week=${week}&view=team`} aria-current={team ? "page" : undefined}>
            {tr("Team")}
          </Link>
        </nav>
      )}
      <div className="actions-bar" style={{ alignItems: "center" }}>
        <Link href={weekLink(addDays(week, -7))} className="btn btn-small" aria-label={tr("Previous week")}>
          ←
        </Link>
        <strong>
          {formatDate(week)} – {formatDate(sunday)}
        </strong>
        <Link href={weekLink(addDays(week, 7))} className="btn btn-small" aria-label={tr("Next week")}>
          →
        </Link>
        {week !== thisWeek && (
          <Link href={weekLink(thisWeek)} className="small">
            {tr("This week")}
          </Link>
        )}
      </div>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{hoursText(total)}</div>
          <div className="l">{tr("Hours this week")}</div>
        </div>
        <div className="stat">
          <div className="n">{hoursText(billable)}</div>
          <div className="l">{tr("Billable hours")}</div>
        </div>
        {team && (
          <div className="stat">
            <div className="n">{formatMoney(value, base)}</div>
            <div className="l">{tr("Value of billable hours")}</div>
          </div>
        )}
      </div>
    </>
  );

  if (team) {
    const names = await namesFor(supabase, lines.map((l) => l.user_id));
    const byPerson = new Map<string, Line[]>();
    for (const l of lines) byPerson.set(l.user_id, [...(byPerson.get(l.user_id) ?? []), l]);
    const people = [...byPerson.entries()]
      .map(([uid, list]) => {
        const hours = list.reduce((s, l) => s + Number(l.hours), 0);
        const bill = list.filter((l) => l.billable).reduce((s, l) => s + Number(l.hours), 0);
        return {
          uid,
          name: names.get(uid) ?? tr("Former member"),
          list,
          hours,
          bill,
          value: list.filter((l) => l.billable).reduce((s, l) => s + Number(l.hours) * Number(l.rate ?? 0), 0),
          cost: list.reduce((s, l) => s + Number(l.hours) * Number(l.cost_rate ?? 0), 0),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {head}
        {people.length === 0 ? (
          <p className="card muted">{tr("Nobody has recorded hours this week.")}</p>
        ) : (
          <section className="card">
            <ul className="lines">
              {people.map((p) => (
                <li key={p.uid}>
                  <details>
                    <summary>
                      <span className="line-head" style={{ display: "inline-flex", width: "calc(100% - 24px)" }}>
                        <span className="desc">{p.name}</span>
                        <strong style={{ whiteSpace: "nowrap" }}>{hoursText(p.hours)} h</strong>
                      </span>
                    </summary>
                    <p className="muted small">
                      {tr("Billable")} {hoursText(p.bill)} h · {tr("Not billable")} {hoursText(p.hours - p.bill)} h · {tr("Value")}{" "}
                      {formatMoney(p.value, base)} · {tr("Cost")} {formatMoney(p.cost, base)}
                    </p>
                    <ul className="lines">
                      {p.list.map((l) => (
                        <li key={l.id} className="small">
                          <div className="line-head">
                            <span>
                              {formatDate(l.work_date)} · {what(l)}
                              {l.description && <span className="muted"> · {l.description}</span>}
                              {!l.billable && <span className="muted"> · {tr("not billable")}</span>}
                            </span>
                            <strong style={{ whiteSpace: "nowrap" }}>{hoursText(Number(l.hours))} h</strong>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  // My hours: the add form needs open jobs I can see, active projects and clients.
  const [{ data: jobData }, { data: projectData }, clients] = await Promise.all([
    supabase.from("service_jobs").select("id, number, title").eq("company_id", company.id).in("status", OPEN_JOB).order("number", { ascending: false }).limit(300),
    supabase.from("projects").select("id, number, name").eq("company_id", company.id).eq("status", "active").order("name").limit(300),
    clientOptions(supabase, company.id),
  ]);
  const jobs = (jobData ?? []) as { id: string; number: string; title: string }[];
  const projects = (projectData ?? []) as { id: string; number: string; name: string }[];
  const defaultDate = today >= week && today <= sunday ? today : week;

  // Days of the week, each with its lines.
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
    .map((d) => ({ d, list: lines.filter((l) => l.work_date === d) }))
    .filter((x) => x.list.length > 0);

  const weekPart = approval ? (
    weekRow?.status === "submitted" ? (
      <p className="small">
        <span className="badge tone-warn">{tr("Waiting for approval")}</span> {tr("This week has been submitted. Ask management to send it back before changing it.")}
      </p>
    ) : weekRow?.status === "approved" ? (
      <p className="small">
        <span className="badge tone-ok">{tr("Approved")}</span> {tr("This week is approved and locked.")}
      </p>
    ) : (
      <form action={submitWeek} className={weekRow?.status === "returned" ? "banner warn" : "card"}>
        <input type="hidden" name="week" value={week} />
        {weekRow?.status === "returned" ? (
          <p className="small" style={{ marginTop: 0 }}>
            <strong>{tr("Sent back by management")}</strong>
            {weekRow.note && `: ${weekRow.note}`}
            <br />
            {tr("Change the hours, then submit the week again.")}
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 0 }}>
            {tr("When the week is complete, submit it to management for approval.")}
          </p>
        )}
        <SubmitButton className="btn btn-small btn-primary" pendingText={tr("Sending…")} disabled={total <= 0}>
          {tr("Submit week")}
        </SubmitButton>
      </form>
    )
  ) : null;

  return (
    <>
      {head}
      {weekPart}
      <form action={addHours} className="card" id="add">
        <h2>{tr("Record hours")}</h2>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="work_date">{tr("Day")}</label>
            <input id="work_date" name="work_date" type="date" required defaultValue={defaultDate} max={addDays(today, 7)} />
          </div>
          <div className="field">
            <label htmlFor="hours">{tr("Hours")}</label>
            <input id="hours" name="hours" type="text" inputMode="decimal" required placeholder={tr("e.g. 7.5")} />
          </div>
          <div className="field">
            <label htmlFor="target">{tr("Job or project")}</label>
            <select id="target" name="target" defaultValue="">
              <option value="">{tr("— None —")}</option>
              {jobs.length > 0 && (
                <optgroup label={tr("Jobs")}>
                  {jobs.map((j) => (
                    <option key={j.id} value={`job:${j.id}`}>
                      {j.number} · {j.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {projects.length > 0 && (
                <optgroup label={tr("Projects")}>
                  {projects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.number} · {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="field">
            <label htmlFor="client_id">{tr("Client")}</label>
            <select id="client_id" name="client_id" defaultValue="">
              <option value="">{tr("— None —")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="hint">{tr("Only when there is no job or project.")}</p>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="description">{tr("What you did")}</label>
            <input id="description" name="description" type="text" maxLength={500} placeholder={tr("e.g. Site survey and drawings")} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="billable" defaultChecked /> {tr("Billable to the client")}
        </label>
        <SubmitButton>{tr("Save hours")}</SubmitButton>
      </form>

      <section className="card">
        <h2>{tr("My hours this week")}</h2>
        {days.length === 0 ? (
          <p className="muted small">{tr("No hours recorded this week.")}</p>
        ) : (
          days.map(({ d, list }) => (
            <div key={d}>
              <h3 className="small" style={{ marginBottom: 4 }}>
                {formatDate(d)} · {hoursText(list.reduce((s, l) => s + Number(l.hours), 0))} h
              </h3>
              <ul className="lines">
                {list.map((l) => (
                  <li key={l.id}>
                    <div className="line-head">
                      <div>
                        <div className="desc">{what(l)}</div>
                        <div className="muted small">
                          {l.description && `${l.description} · `}
                          {l.billable ? tr("billable") : tr("not billable")}
                          {l.invoice_id && ` · ${tr("invoiced")}`}
                        </div>
                      </div>
                      <strong style={{ whiteSpace: "nowrap" }}>{hoursText(Number(l.hours))} h</strong>
                    </div>
                    {!l.invoice_id && !(locked && !manager) && (
                      <form action={removeHours}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="week" value={week} />
                        <SubmitButton className="btn btn-small">{tr("Remove")}</SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
