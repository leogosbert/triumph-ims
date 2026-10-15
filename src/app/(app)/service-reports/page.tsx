import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { chunk, formatDate } from "@/lib/format";
import type { SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { FREQUENCIES, JOB_KINDS, JOB_STATUS, OPEN_JOB, canSeeAllService, daysFromToday, todayTz } from "@/lib/services";

export const metadata = { title: "Service reports" };

type Job = {
  id: string;
  number: string;
  title: string;
  kind: string;
  status: string;
  price: number | null;
  currency: string;
  completed_at: string | null;
  scheduled_for: string | null;
  due_by: string | null;
  assigned_to: string[] | null;
  client: { name: string } | null;
  lines?: { kind: string; product_id: string | null; quantity: number; unit_price: number; unit_cost: number | null }[];
};

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const hrs = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-GB");

export default async function ServiceReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company, role } = await getAppContext();
  if (!canSeeAllService(role)) redirect("/");
  const today = todayTz();
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const from = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const to = addDays(next, -1);
  const fromTs = `${from}T00:00:00+03:00`;
  const nextTs = `${next}T00:00:00+03:00`;
  const nowIso = new Date().toISOString();
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);
  const cur = company.base_currency;
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  const [done, late, contracts, dueEquipment, warranties, hours, openJobs, invoices] = await Promise.all([
    supabase
      .from("service_jobs")
      .select("id, number, title, kind, status, price, currency, completed_at, scheduled_for, due_by, assigned_to, client:clients(name), lines:service_job_lines(kind, product_id, quantity, unit_price, unit_cost)")
      .eq("company_id", company.id)
      .in("status", ["completed", "invoiced"])
      .gte("completed_at", fromTs)
      .lt("completed_at", nextTs)
      .order("completed_at")
      .limit(500),
    supabase
      .from("service_jobs")
      .select("id, number, title, kind, status, price, currency, completed_at, scheduled_for, due_by, assigned_to, client:clients(name)")
      .eq("company_id", company.id)
      .in("status", OPEN_JOB)
      .or(`due_by.lt.${nowIso},scheduled_for.lt.${nowIso}`)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("service_contracts")
      .select("id, number, title, frequency, next_visit_on, site, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "active")
      .not("next_visit_on", "is", null)
      .lte("next_visit_on", in30)
      .order("next_visit_on")
      .limit(200),
    supabase
      .from("client_equipment")
      .select("id, name, serial_no, location, next_service_on, client:clients(name)")
      .eq("company_id", company.id)
      .eq("active", true)
      .not("next_service_on", "is", null)
      .lte("next_service_on", in30)
      .order("next_service_on")
      .limit(200),
    supabase
      .from("client_equipment")
      .select("id, name, serial_no, location, warranty_until, client:clients(name)")
      .eq("company_id", company.id)
      .eq("active", true)
      .gte("warranty_until", today)
      .lte("warranty_until", in60)
      .order("warranty_until")
      .limit(200),
    supabase
      .from("timesheets")
      .select("user_id, hours, billable")
      .eq("company_id", company.id)
      .gte("work_date", from)
      .lte("work_date", to)
      .limit(10000),
    supabase.from("service_jobs").select("assigned_to").eq("company_id", company.id).in("status", OPEN_JOB).limit(2000),
    supabase
      .from("invoices")
      .select("id, exchange_rate, lines:invoice_lines(line_total, is_service)")
      .eq("company_id", company.id)
      .in("status", ["issued", "partly_paid", "paid"])
      .gte("issue_date", from)
      .lte("issue_date", to)
      .limit(3000),
  ]);
  if (isMissingTable(done.error) || isMissingTable(late.error) || isMissingTable(contracts.error) || isMissingTable(hours.error)) {
    return <NotReady title="Service reports" />;
  }
  for (const r of [done, late, contracts, dueEquipment, warranties, hours, openJobs]) if (r.error) throw new Error(r.error.message);

  // (a) Income: services vs goods (in the base currency).
  let services = 0;
  let goods = 0;
  for (const inv of (invoices.data ?? []) as unknown as { exchange_rate: number; lines: { line_total: number; is_service: boolean }[] }[]) {
    for (const l of inv.lines ?? []) {
      const v = Number(l.line_total) * Number(inv.exchange_rate ?? 1);
      if (l.is_service) services += v;
      else goods += v;
    }
  }
  const income = services + goods;
  const pct = (v: number) => (income > 0 ? `${Math.round((v / income) * 100)}%` : "–");

  // (b) Jobs completed: billed value, material and labour cost, profit.
  const jobs = (done.data ?? []) as unknown as Job[];
  const jobIds = jobs.map((j) => j.id);
  const needCost = [...new Set(jobs.flatMap((j) => (j.lines ?? []).filter((l) => l.kind === "material" && l.unit_cost == null && l.product_id).map((l) => l.product_id as string)))];
  const lastCost = new Map<string, number>();
  const labour = new Map<string, number>();
  await Promise.all([
    ...chunk(needCost).map(async (ids) => {
      const { data } = await supabase.from("product_costs").select("product_id, last_cost").in("product_id", ids);
      for (const c of (data ?? []) as { product_id: string; last_cost: number | null }[]) lastCost.set(c.product_id, Number(c.last_cost ?? 0));
    }),
    ...chunk(jobIds).map(async (ids) => {
      const { data } = await supabase.from("timesheets").select("job_id, hours, cost_rate").in("job_id", ids).limit(10000);
      for (const t of (data ?? []) as { job_id: string; hours: number; cost_rate: number | null }[]) {
        labour.set(t.job_id, (labour.get(t.job_id) ?? 0) + Number(t.hours) * Number(t.cost_rate ?? 0));
      }
    }),
  ]);
  const jobRows = jobs.map((j) => {
    const lines = j.lines ?? [];
    const billed = j.price != null ? Number(j.price) : lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
    const material = lines
      .filter((l) => l.kind === "material")
      .reduce((s, l) => s + Number(l.quantity) * (l.unit_cost != null ? Number(l.unit_cost) : lastCost.get(l.product_id ?? "") ?? 0), 0);
    const lab = labour.get(j.id) ?? 0;
    return { j, billed, material, labour: lab, profit: billed - material - lab };
  });
  const sum = (k: "billed" | "material" | "labour" | "profit") => jobRows.reduce((s, r) => s + r[k], 0);
  const oneCurrency = jobRows.every((r) => r.j.currency === cur);

  // (c) Late and open jobs.
  const lateJobs = (late.data ?? []) as unknown as Job[];

  // (f) Workload.
  const people = new Map<string, { billable: number; other: number; open: number }>();
  const person = (id: string) => {
    let p = people.get(id);
    if (!p) people.set(id, (p = { billable: 0, other: 0, open: 0 }));
    return p;
  };
  for (const t of (hours.data ?? []) as { user_id: string; hours: number; billable: boolean }[]) {
    if (t.billable) person(t.user_id).billable += Number(t.hours);
    else person(t.user_id).other += Number(t.hours);
  }
  for (const j of (openJobs.data ?? []) as { assigned_to: string[] | null }[]) for (const u of j.assigned_to ?? []) person(u).open += 1;
  const names = await namesFor(supabase, [...people.keys()]);
  const workload = [...people].map(([id, v]) => ({ id, name: names.get(id) ?? tr("Former member"), ...v })).sort((a, b) => b.billable + b.other - (a.billable + a.other) || a.name.localeCompare(b.name));

  const visits = (contracts.data ?? []) as unknown as { id: string; number: string; title: string; frequency: string; next_visit_on: string; site: string | null; client: { name: string } | null }[];
  const equipment = (dueEquipment.data ?? []) as unknown as { id: string; name: string; serial_no: string | null; location: string | null; next_service_on: string; client: { name: string } | null }[];
  const ending = (warranties.data ?? []) as unknown as { id: string; name: string; serial_no: string | null; location: string | null; warranty_until: string; client: { name: string } | null }[];
  const whenText = (d: string) => {
    const n = daysFromToday(d) ?? 0;
    return n < 0 ? `${-n} ${tr("days late")}` : n === 0 ? tr("today") : `${tr("in")} ${n} ${tr("days")}`;
  };

  return (
    <>
      <div className="page-head no-print">
        <h1>{tr("Service reports")}</h1>
        <PrintButton />
      </div>
      <form method="get" className="card no-print" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Link href={`/service-reports?month=${shiftMonth(month, -1)}`} className="btn btn-small" aria-label={tr("Previous month")}>
          ←
        </Link>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="month">{tr("Month")}</label>
          <input id="month" name="month" type="month" defaultValue={month} />
        </div>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
        <Link href={`/service-reports?month=${shiftMonth(month, 1)}`} className="btn btn-small" aria-label={tr("Next month")}>
          →
        </Link>
      </form>

      <div className="report-print">
        <div className="rep-head">
          <div className="rep-company">{company.name}</div>
          <h2>
            {tr("Service reports")} · {monthName}
          </h2>
          <p className="muted small">
            {tr("Printed")} {formatDate(today)}
          </p>
        </div>

        <section className="card">
          <h2>{tr("Income: services and goods")}</h2>
          <p className="muted small">{tr("Invoices issued in the month (drafts and cancelled invoices left out), before VAT, in")} {cur}.</p>
          <div className="scroll-x">
            <table className="compare rep-table">
              <thead>
                <tr>
                  <th>{tr("Type")}</th>
                  <th className="num">{tr("Amount")}</th>
                  <th className="num">{tr("Share")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{tr("Services")}</td>
                  <td className="num">{formatMoney(services, cur)}</td>
                  <td className="num">{pct(services)}</td>
                </tr>
                <tr>
                  <td>{tr("Goods")}</td>
                  <td className="num">{formatMoney(goods, cur)}</td>
                  <td className="num">{pct(goods)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>{tr("Total")}</td>
                  <td className="num">{formatMoney(income, cur)}</td>
                  <td className="num">{income > 0 ? "100%" : "–"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>
            {tr("Jobs completed")} <span className="small muted">· {jobRows.length}</span>
          </h2>
          {jobRows.length === 0 ? (
            <p className="muted small">{tr("No jobs were completed in this month.")}</p>
          ) : (
            <>
              <p className="muted small">{tr("Material cost uses the cost on the job, else the last purchase cost. Labour cost is hours on the job × each person's cost rate.")}</p>
              <div className="scroll-x">
                <table className="compare rep-table">
                  <thead>
                    <tr>
                      <th>{tr("Job")}</th>
                      <th>{tr("Client")}</th>
                      <th>{tr("Kind")}</th>
                      <th className="num">{tr("Billed")}</th>
                      <th className="num">{tr("Materials")}</th>
                      <th className="num">{tr("Labour")}</th>
                      <th className="num">{tr("Profit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobRows.map((r) => (
                      <tr key={r.j.id}>
                        <td>
                          <Link href={`/jobs/${r.j.id}`}>{r.j.number}</Link>
                          <div className="muted small">{r.j.title}</div>
                        </td>
                        <td>{r.j.client?.name}</td>
                        <td>{tr(JOB_KINDS[r.j.kind] ?? r.j.kind)}</td>
                        <td className="num">{formatMoney(r.billed, r.j.currency)}</td>
                        <td className="num">{formatMoney(r.material, cur)}</td>
                        <td className="num">{formatMoney(r.labour, cur)}</td>
                        <td className={`num ${r.profit < 0 ? "text-warn" : ""}`}>{formatMoney(r.profit, r.j.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {oneCurrency && (
                    <tfoot>
                      <tr>
                        <td>{tr("Total")}</td>
                        <td />
                        <td />
                        <td className="num">{formatMoney(sum("billed"), cur)}</td>
                        <td className="num">{formatMoney(sum("material"), cur)}</td>
                        <td className="num">{formatMoney(sum("labour"), cur)}</td>
                        <td className="num">{formatMoney(sum("profit"), cur)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>
            {tr("Late and open jobs")} <span className="small muted">· {lateJobs.length}</span>
          </h2>
          {lateJobs.length === 0 ? (
            <p className="muted small">{tr("No open jobs are past their date.")}</p>
          ) : (
            <div className="scroll-x">
              <table className="compare rep-table">
                <thead>
                  <tr>
                    <th>{tr("Job")}</th>
                    <th>{tr("Client")}</th>
                    <th>{tr("Status")}</th>
                    <th>{tr("Planned for")}</th>
                    <th>{tr("Due by")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lateJobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Link href={`/jobs/${j.id}`}>{j.number}</Link>
                        <div className="muted small">{j.title}</div>
                      </td>
                      <td>{j.client?.name}</td>
                      <td>{tr(JOB_STATUS[j.status]?.label ?? j.status)}</td>
                      <td>{j.scheduled_for ? formatDate(j.scheduled_for) : "–"}</td>
                      <td className={j.due_by && j.due_by < nowIso ? "text-warn" : undefined}>{j.due_by ? formatDate(j.due_by) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>{tr("Maintenance due in the next 30 days")}</h2>
          {visits.length === 0 && equipment.length === 0 ? (
            <p className="muted small">{tr("No maintenance visits or equipment services due.")}</p>
          ) : (
            <div className="scroll-x">
              <table className="compare rep-table">
                <thead>
                  <tr>
                    <th>{tr("Due")}</th>
                    <th>{tr("Client")}</th>
                    <th>{tr("What")}</th>
                    <th>{tr("When")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDate(c.next_visit_on)}</td>
                      <td>{c.client?.name}</td>
                      <td>
                        <Link href={`/maintenance/${c.id}`}>{c.number}</Link> · {c.title}
                        <div className="muted small">
                          {tr("Maintenance visit")} · {tr(FREQUENCIES[c.frequency] ?? c.frequency)}
                          {c.site && ` · ${c.site}`}
                        </div>
                      </td>
                      <td className={c.next_visit_on < today ? "text-warn" : undefined}>{whenText(c.next_visit_on)}</td>
                    </tr>
                  ))}
                  {equipment.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.next_service_on)}</td>
                      <td>{e.client?.name}</td>
                      <td>
                        <Link href={`/equipment/${e.id}`}>{e.name}</Link>
                        <div className="muted small">
                          {tr("Equipment service")}
                          {e.serial_no && ` · ${e.serial_no}`}
                          {e.location && ` · ${e.location}`}
                        </div>
                      </td>
                      <td className={e.next_service_on < today ? "text-warn" : undefined}>{whenText(e.next_service_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>{tr("Warranties ending in the next 60 days")}</h2>
          {ending.length === 0 ? (
            <p className="muted small">{tr("No warranties end in the next 60 days.")}</p>
          ) : (
            <div className="scroll-x">
              <table className="compare rep-table">
                <thead>
                  <tr>
                    <th>{tr("Equipment")}</th>
                    <th>{tr("Client")}</th>
                    <th>{tr("Warranty until")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ending.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/equipment/${e.id}`}>{e.name}</Link>
                        {(e.serial_no || e.location) && <div className="muted small">{[e.serial_no, e.location].filter(Boolean).join(" · ")}</div>}
                      </td>
                      <td>{e.client?.name}</td>
                      <td>
                        {formatDate(e.warranty_until)} <span className="muted small">· {whenText(e.warranty_until)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>{tr("Workload")}</h2>
          <p className="muted small">{tr("Hours entered in the month and open jobs assigned to each person now.")}</p>
          {workload.length === 0 ? (
            <p className="muted small">{tr("No hours or assigned jobs.")}</p>
          ) : (
            <div className="scroll-x">
              <table className="compare rep-table">
                <thead>
                  <tr>
                    <th>{tr("Person")}</th>
                    <th className="num">{tr("Billable hours")}</th>
                    <th className="num">{tr("Non-billable hours")}</th>
                    <th className="num">{tr("Open jobs")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{hrs(p.billable)}</td>
                      <td className="num">{hrs(p.other)}</td>
                      <td className="num">{p.open}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{tr("Total")}</td>
                    <td className="num">{hrs(workload.reduce((s, p) => s + p.billable, 0))}</td>
                    <td className="num">{hrs(workload.reduce((s, p) => s + p.other, 0))}</td>
                    <td className="num">{(openJobs.data ?? []).length}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
