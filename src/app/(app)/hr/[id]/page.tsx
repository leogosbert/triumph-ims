import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import {
  EMPLOYEE_FIELDS,
  EMPLOYMENT_TYPES,
  LEAVE_KINDS,
  LEAVE_STATUS,
  certState,
  daysText,
  employeeFlags,
  num,
  thisYear,
  type Certificate,
  type Employee,
  type LeaveBalance,
  type LeaveRequest,
} from "@/lib/hr";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople, namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { todayTz } from "@/lib/services";
import { addCertificate, removeCertificate, saveEmployee, setEmployeeStatus } from "../actions";
import { EmployeeFields } from "../EmployeeFields";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Employee" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <div className="muted small">{tr(label)}</div>
      <div>{value}</div>
    </div>
  );
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, user } = await getAppContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await supabase.from("employees").select(EMPLOYEE_FIELDS).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Employee" />;
  if (error) throw new Error(error.message);
  if (!data) {
    if (!can(roles, "seeEmployees")) redirect("/hr");
    notFound();
  }
  const e = data as unknown as Employee;
  const self = e.user_id === user.id;
  if (!can(roles, "seeEmployees") && !self) redirect("/hr");
  const manager = can(roles, "manageHr");
  const year = thisYear();
  const today = todayTz();

  const [{ data: certData }, { data: leaveData }, balanceRes, linkedRes, people] = await Promise.all([
    supabase.from("employee_certificates").select("id, employee_id, name, issuer, number, issued_on, expires_on, notes").eq("employee_id", id).order("expires_on", { ascending: true, nullsFirst: false }),
    supabase
      .from("leave_requests")
      .select("id, employee_id, kind, starts_on, ends_on, days, reason, status, decision_note, created_at")
      .eq("employee_id", id)
      .order("starts_on", { ascending: false })
      .limit(10),
    supabase.rpc("leave_balance", { p_employee: id, p_year: year }),
    manager ? supabase.from("employees").select("user_id").eq("company_id", company.id).not("user_id", "is", null).neq("id", id).limit(5000) : Promise.resolve({ data: [] }),
    manager ? companyPeople(supabase, company.id) : Promise.resolve([]),
  ]);
  const certs = (certData ?? []) as Certificate[];
  const leave = (leaveData ?? []) as LeaveRequest[];
  const balance = (balanceRes.error ? null : balanceRes.data) as LeaveBalance | null;
  const taken = new Set(((linkedRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const logins = people.filter((p) => !taken.has(p.id));
  const loginName = e.user_id ? (await namesFor(supabase, [e.user_id])).get(e.user_id) : null;
  const onLeaveToday = leave.some((l) => l.status === "approved" && l.starts_on <= today && l.ends_on >= today);
  const flags = employeeFlags(e, certs, onLeaveToday);
  const active = e.status === "active";

  return (
    <>
      <BackLink href={can(roles, "seeEmployees") ? "/hr" : "/hr/leave"} label={can(roles, "seeEmployees") ? "Employees" : "Leave"} />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{e.full_name}</h1>
        {!active && <span className="badge tone-off">{tr("Left")}</span>}
      </div>
      <p className="muted small">
        {e.employee_no}
        {e.job_title && ` · ${e.job_title}`}
        {e.department && ` · ${e.department}`}
        {` · ${tr(EMPLOYMENT_TYPES[e.employment_type] ?? e.employment_type)}`}
      </p>
      <Notice {...notice} />
      {!active && (
        <p className="banner warn small">
          {tr("Left on")} {e.end_date ? formatDate(e.end_date) : "—"}
          {e.leaving_reason && ` · ${e.leaving_reason}`}
        </p>
      )}
      {flags.length > 0 && (
        <p style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {flags.map((f) => (
            <span key={f.label} className={`badge tone-${f.tone}`}>
              {tr(f.label)}
            </span>
          ))}
        </p>
      )}
      <div className="actions-bar">
        {active && (self || manager) && (
          <Link href={self ? "/hr/leave#ask" : `/hr/leave?employee=${e.id}#ask`} className="btn btn-small btn-primary">
            {tr("Ask for leave")}
          </Link>
        )}
        {can(roles, "runPayroll") && (
          <Link href={`/payroll/pay/${e.id}`} className="btn btn-small">
            {tr("Pay details")}
          </Link>
        )}
      </div>

      <section className="card">
        <h2>{tr("Details")}</h2>
        <div className="grid grid-2">
          <Row label="LeMoSp login" value={loginName ?? (e.user_id ? "—" : tr("No login"))} />
          <Row label="Start date" value={e.start_date ? formatDate(e.start_date) : null} />
          <Row label="Probation ends" value={e.probation_end ? formatDate(e.probation_end) : null} />
          <Row label="Contract ends" value={e.contract_end ? formatDate(e.contract_end) : null} />
          <Row label="Phone" value={e.phone ? <a href={`tel:${e.phone}`}>{e.phone}</a> : null} />
          <Row label="Email" value={e.email ? <a href={`mailto:${e.email}`}>{e.email}</a> : null} />
          <Row label="Emergency contact" value={[e.emergency_contact, e.emergency_phone].filter(Boolean).join(" · ")} />
          <Row label="NIDA number" value={e.id_number} />
          <Row label="TIN" value={e.tin} />
          <Row label="NSSF number" value={e.nssf_no} />
          <Row label="Annual leave days" value={daysText(e.annual_leave_days)} />
        </div>
        {e.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{e.notes}</p>}
      </section>

      <section className="card" id="leave">
        <h2>
          {tr("Leave")} {year}
        </h2>
        {balance && (
          <div className="stat-grid">
            <div className="stat">
              <div className="n">{daysText(num(balance.entitled))}</div>
              <div className="l">{tr("Annual leave days")}</div>
            </div>
            <div className="stat">
              <div className="n">{daysText(num(balance.taken))}</div>
              <div className="l">{tr("Days taken")}</div>
            </div>
            <div className={`stat ${num(balance.waiting) > 0 ? "alert" : ""}`}>
              <div className="n">{daysText(num(balance.waiting))}</div>
              <div className="l">{tr("Waiting for approval")}</div>
            </div>
            <div className="stat">
              <div className="n">{daysText(num(balance.left))}</div>
              <div className="l">{tr("Days left")}</div>
            </div>
          </div>
        )}
        {balance && Object.keys(balance.by_kind ?? {}).some((k) => k !== "annual") && (
          <p className="muted small">
            {tr("Other leave taken")}:{" "}
            {Object.entries(balance.by_kind)
              .filter(([k]) => k !== "annual")
              .map(([k, d]) => `${tr(LEAVE_KINDS[k] ?? k)} ${daysText(num(d))}`)
              .join(" · ")}
          </p>
        )}
        {leave.length === 0 ? (
          <p className="muted small">{tr("No leave requests yet.")}</p>
        ) : (
          <ul className="lines">
            {leave.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{tr(LEAVE_KINDS[l.kind] ?? l.kind)}</div>
                    <div className="muted small">
                      {formatDate(l.starts_on)} – {formatDate(l.ends_on)} · {daysText(l.days)} {tr("working days")}
                      {l.decision_note && ` · ${l.decision_note}`}
                    </div>
                  </div>
                  <StatusBadge map={LEAVE_STATUS} status={l.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="small">
          <Link href="/hr/leave">{tr("All leave")}</Link>
        </p>
      </section>

      <section className="card" id="certificates">
        <h2>{tr("Certificates & licences")}</h2>
        {certs.length === 0 ? (
          <p className="muted small">{tr("No certificates or licences yet.")}</p>
        ) : (
          <ul className="lines">
            {certs.map((c) => {
              const st = certState(c.expires_on);
              return (
                <li key={c.id}>
                  <div className="line-head">
                    <div>
                      <div className="desc">{c.name}</div>
                      <div className="muted small">
                        {[c.issuer, c.number].filter(Boolean).join(" · ")}
                        {c.issued_on && ` · ${tr("issued")} ${formatDate(c.issued_on)}`}
                        {c.expires_on && ` · ${tr("expires")} ${formatDate(c.expires_on)}`}
                        {c.notes && ` · ${c.notes}`}
                      </div>
                    </div>
                    <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
                  </div>
                  {manager && (
                    <form action={removeCertificate}>
                      <input type="hidden" name="employee_id" value={e.id} />
                      <input type="hidden" name="certificate_id" value={c.id} />
                      <SubmitButton className="btn btn-small" pendingText={tr("Removing…")}>
                        {tr("Remove")}
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {manager && (
          <details style={{ marginTop: 12 }}>
            <summary>{tr("+ Certificate or licence")}</summary>
            <form action={addCertificate} style={{ marginTop: 12 }}>
              <input type="hidden" name="employee_id" value={e.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="cert_name">{tr("Name")}</label>
                  <input id="cert_name" name="name" type="text" required minLength={2} maxLength={120} placeholder={tr("e.g. Driving licence class C")} />
                </div>
                <div className="field">
                  <label htmlFor="cert_issuer">{tr("Issued by")}</label>
                  <input id="cert_issuer" name="issuer" type="text" maxLength={120} placeholder={tr("e.g. LATRA, OSHA, Red Cross")} />
                </div>
                <div className="field">
                  <label htmlFor="cert_number">{tr("Number")}</label>
                  <input id="cert_number" name="number" type="text" maxLength={60} />
                </div>
                <div className="field">
                  <label htmlFor="cert_issued">{tr("Issued on")}</label>
                  <input id="cert_issued" name="issued_on" type="date" />
                </div>
                <div className="field">
                  <label htmlFor="cert_expires">{tr("Expires on")}</label>
                  <input id="cert_expires" name="expires_on" type="date" />
                </div>
                <div className="field">
                  <label htmlFor="cert_notes">{tr("Notes")}</label>
                  <input id="cert_notes" name="notes" type="text" maxLength={500} />
                </div>
              </div>
              <SubmitButton className="btn btn-small btn-primary">{tr("Add certificate")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {manager && (
        <>
          <details className="card">
            <summary>{tr("Change details")}</summary>
            <form action={saveEmployee} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={e.id} />
              <EmployeeFields e={e} logins={logins} />
              <SubmitButton>{tr("Save")}</SubmitButton>
            </form>
          </details>
          {active ? (
            <details className="card">
              <summary>{tr("Mark as left")}</summary>
              <form action={setEmployeeStatus} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="status" value="left" />
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="left_date">{tr("Last day")}</label>
                    <input id="left_date" name="date" type="date" defaultValue={today} />
                  </div>
                  <div className="field">
                    <label htmlFor="left_reason">{tr("Reason")}</label>
                    <input id="left_reason" name="reason" type="text" maxLength={300} placeholder={tr("e.g. Resigned, contract ended")} />
                  </div>
                </div>
                <p className="hint">{tr("The file and its history are kept. You can bring the person back later.")}</p>
                <SubmitButton className="btn btn-small">{tr("Mark as left")}</SubmitButton>
              </form>
            </details>
          ) : (
            <form action={setEmployeeStatus} className="card">
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="status" value="active" />
              <p className="small">{tr("Has this person come back to work?")}</p>
              <SubmitButton className="btn btn-small">{tr("Bring back")}</SubmitButton>
            </form>
          )}
        </>
      )}
    </>
  );
}
