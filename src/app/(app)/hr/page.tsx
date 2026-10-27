import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { EMPLOYEE_FIELDS, EMPLOYMENT_TYPES, employeeFlags, num, type AdminSummary, type Certificate, type Employee } from "@/lib/hr";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/services";

export const metadata = { title: "Employees" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();

  if (!can(roles, "seeEmployees")) {
    // Everyone else: their own file, when management has made one.
    const { data: mine, error } = await supabase.rpc("my_employee_id", { p_company: company.id });
    if (error) return <NotReady title="Employees" />;
    if (mine) redirect(`/hr/${mine as string}`);
    return (
      <>
        <h1>{tr("My employee file")}</h1>
        <Notice {...notice} />
        <section className="card">
          <p>{tr("Management has not added your employee file yet.")}</p>
          <p className="muted small">{tr("When they do, you will see your job details, certificates and leave balance here.")}</p>
          <Link href="/hr/leave" className="btn btn-small">
            {tr("Leave")}
          </Link>
        </section>
      </>
    );
  }

  const left = pick(sp.tab) === "left";
  const q = (pick(sp.q) ?? "").trim();
  let query = supabase
    .from("employees")
    .select(EMPLOYEE_FIELDS)
    .eq("company_id", company.id)
    .eq("status", left ? "left" : "active")
    .order("full_name")
    .limit(1000);
  if (q) query = query.ilike("full_name", `%${q.replace(/[%_,()]/g, " ")}%`);
  const { data, error } = await query;
  if (isMissingTable(error)) return <NotReady title="Employees" />;
  if (error) throw new Error(error.message);
  const employees = (data ?? []) as unknown as Employee[];
  const today = todayTz();

  const [summaryRes, { data: certData }, { data: leaveData }] = await Promise.all([
    supabase.rpc("admin_summary", { p_company: company.id }),
    supabase.from("employee_certificates").select("id, employee_id, expires_on").eq("company_id", company.id).not("expires_on", "is", null).limit(5000),
    supabase
      .from("leave_requests")
      .select("employee_id")
      .eq("company_id", company.id)
      .eq("status", "approved")
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(1000),
  ]);
  const s = (summaryRes.error ? null : summaryRes.data) as AdminSummary | null;
  const certs = (certData ?? []) as Certificate[];
  const onLeave = new Set(((leaveData ?? []) as { employee_id: string }[]).map((l) => l.employee_id));
  const certsOf = new Map<string, Certificate[]>();
  for (const c of certs) certsOf.set(c.employee_id, [...(certsOf.get(c.employee_id) ?? []), c]);
  const manager = can(roles, "manageHr");

  const tiles = s
    ? [
        { n: num(s.employees), l: "Employees", href: "/hr", alert: false },
        { n: num(s.on_leave_today), l: "On leave today", href: "/hr/leave", alert: false },
        { n: num(s.certs_expired), l: "Certificates expired", href: "/hr", alert: num(s.certs_expired) > 0 },
        { n: num(s.certs_expiring), l: "Certificates expiring (30 days)", href: "/hr", alert: num(s.certs_expiring) > 0 },
        { n: num(s.contracts_ending), l: "Contracts ending (30 days)", href: "/hr", alert: num(s.contracts_ending) > 0 },
        { n: num(s.leave_waiting), l: "Leave waiting", href: "/hr/leave", alert: num(s.leave_waiting) > 0 },
      ]
    : [];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Employees")}</h1>
        {manager && (
          <Link href="/hr/new" className="btn btn-primary btn-small">
            {tr("+ Employee")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Employee files with contracts, certificates and leave.")}</p>
      <Notice {...notice} />
      {tiles.length > 0 && (
        <div className="stat-grid">
          {tiles.map((t) => (
            <Link key={t.l} href={t.href} className={`stat ${t.alert ? "alert" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="n">{t.n}</div>
              <div className="l">{tr(t.l)}</div>
            </Link>
          ))}
        </div>
      )}
      <div className="actions-bar">
        <Link href="/hr/leave" className="btn btn-small">
          {tr("Leave")}
        </Link>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/hr" aria-current={!left ? "page" : undefined}>
          {tr("Active")}
        </Link>
        <Link href="/hr?tab=left" aria-current={left ? "page" : undefined}>
          {tr("Left")}
        </Link>
      </nav>
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        {left && <input type="hidden" name="tab" value="left" />}
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search by name…")} aria-label={tr("Search")} />
        <button className="btn" type="submit">
          {tr("Search")}
        </button>
      </form>
      {employees.length === 0 ? (
        <p className="card muted">
          {q ? tr("Nobody found with that name.") : left ? tr("Nobody has left.") : tr("No employees yet. Add your people to keep their files, certificates and leave in one place.")}
        </p>
      ) : (
        <ul className="rec-list">
          {employees.map((e) => {
            const flags = employeeFlags(e, certsOf.get(e.id) ?? [], onLeave.has(e.id));
            return (
              <li key={e.id}>
                <Link href={`/hr/${e.id}`}>
                  <div className="main">
                    <div className="title">{e.full_name}</div>
                    <div className="sub">
                      {e.employee_no}
                      {e.job_title && ` · ${e.job_title}`}
                      {e.department && ` · ${e.department}`}
                      {` · ${tr(EMPLOYMENT_TYPES[e.employment_type] ?? e.employment_type)}`}
                    </div>
                  </div>
                  <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    {e.status === "left" ? (
                      <span className="badge tone-off">{tr("Left")}</span>
                    ) : (
                      flags.map((f) => (
                        <span key={f.label} className={`badge tone-${f.tone}`}>
                          {tr(f.label)}
                        </span>
                      ))
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
