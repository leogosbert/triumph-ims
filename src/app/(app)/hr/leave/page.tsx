import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { LEAVE_KINDS, LEAVE_STATUS, daysText, num, thisYear, type LeaveBalance, type LeaveRequest } from "@/lib/hr";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { todayTz } from "@/lib/services";
import { addDays } from "../../timesheets/week";
import { cancelLeave, decideLeave, requestLeave } from "../actions";

export const metadata = { title: "Leave" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SELECT = "id, employee_id, kind, starts_on, ends_on, days, reason, status, decision_note, created_at";

const TABS = [
  { key: "waiting", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
];

export default async function LeavePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const manager = can(role, "manageHr");
  const tab = TABS.find((t) => t.key === pick(sp.tab)) ?? TABS[0];
  const today = todayTz();

  const { data: meData, error: meError } = await supabase.rpc("my_employee_id", { p_company: company.id });
  if (meError) return <NotReady title="Leave" />;
  const me = (meData as string | null) ?? null;

  // People: management chooses anyone active; everyone else only themselves.
  const { data: empData, error: empError } = await supabase.from("employees").select("id, full_name, status").eq("company_id", company.id).order("full_name").limit(2000);
  if (isMissingTable(empError)) return <NotReady title="Leave" />;
  const employees = (empData ?? []) as { id: string; full_name: string; status: string }[];
  const nameOf = new Map(employees.map((e) => [e.id, e.full_name]));
  const choosable = manager ? employees.filter((e) => e.status === "active") : employees.filter((e) => e.id === me && e.status === "active");
  const wanted = pick(sp.employee);
  const defaultEmployee = choosable.find((e) => e.id === wanted)?.id ?? (choosable.find((e) => e.id === me)?.id ?? choosable[0]?.id ?? "");

  let teamQuery = supabase.from("leave_requests").select(SELECT).eq("company_id", company.id);
  if (tab.key === "waiting") teamQuery = teamQuery.eq("status", "requested").order("starts_on");
  else if (tab.key === "approved") teamQuery = teamQuery.eq("status", "approved").order("starts_on", { ascending: false });
  else teamQuery = teamQuery.order("starts_on", { ascending: false });

  const [teamRes, awayRes, mineRes, balanceRes] = await Promise.all([
    manager ? teamQuery.limit(200) : Promise.resolve({ data: [] }),
    manager
      ? supabase.from("leave_requests").select(SELECT).eq("company_id", company.id).eq("status", "approved").lte("starts_on", addDays(today, 14)).gte("ends_on", today).order("starts_on").limit(200)
      : Promise.resolve({ data: [] }),
    me ? supabase.from("leave_requests").select(SELECT).eq("employee_id", me).order("starts_on", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    me ? supabase.rpc("leave_balance", { p_employee: me, p_year: thisYear() }) : Promise.resolve({ data: null, error: null }),
  ]);
  const team = (teamRes.data ?? []) as LeaveRequest[];
  const away = (awayRes.data ?? []) as LeaveRequest[];
  const mine = (mineRes.data ?? []) as LeaveRequest[];
  const balance = (balanceRes.error ? null : balanceRes.data) as LeaveBalance | null;

  const canCancel = (l: LeaveRequest) => (l.status === "requested" || l.status === "approved") && (manager || l.starts_on > today);
  const back = `/hr/leave${tab.key !== "waiting" ? `?tab=${tab.key}` : ""}`;

  const item = (l: LeaveRequest, opts: { name: boolean; decide: boolean; cancel: boolean }) => (
    <li key={l.id}>
      <div className="line-head">
        <div>
          <div className="desc">
            {opts.name ? (
              <Link href={`/hr/${l.employee_id}#leave`}>{nameOf.get(l.employee_id) ?? tr("Employee")}</Link>
            ) : (
              tr(LEAVE_KINDS[l.kind] ?? l.kind)
            )}
          </div>
          <div className="muted small">
            {opts.name && `${tr(LEAVE_KINDS[l.kind] ?? l.kind)} · `}
            {formatDate(l.starts_on)} – {formatDate(l.ends_on)} · {daysText(l.days)} {tr("working days")}
          </div>
          {l.reason && <div className="small">{l.reason}</div>}
          {l.decision_note && (
            <div className="muted small">
              {tr("Note")}: {l.decision_note}
            </div>
          )}
        </div>
        <StatusBadge map={LEAVE_STATUS} status={l.status} />
      </div>
      {opts.decide && l.status === "requested" && (
        <form action={decideLeave} style={{ marginTop: 8 }}>
          <input type="hidden" name="request_id" value={l.id} />
          <input type="hidden" name="back" value={back} />
          <div className="field">
            <input name="note" type="text" maxLength={500} placeholder={tr("Note (optional; say why when declining)")} aria-label={tr("Note")} />
          </div>
          <div className="actions-bar" style={{ marginBottom: 0 }}>
            <SubmitButton className="btn btn-small btn-primary" name="decision" value="approve" pendingText={tr("Saving…")}>
              {tr("Approve")}
            </SubmitButton>
            <SubmitButton className="btn btn-small" name="decision" value="decline" pendingText={tr("Saving…")}>
              {tr("Decline")}
            </SubmitButton>
          </div>
        </form>
      )}
      {opts.cancel && canCancel(l) && (
        <form action={cancelLeave} style={{ marginTop: 8 }}>
          <input type="hidden" name="request_id" value={l.id} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="btn btn-small" pendingText={tr("Cancelling…")}>
            {tr("Cancel leave")}
          </SubmitButton>
        </form>
      )}
    </li>
  );

  return (
    <>
      {can(role, "seeEmployees") && (
        <p className="small">
          <Link href="/hr">{tr("← Employees")}</Link>
        </p>
      )}
      <div className="page-head">
        <h1>{tr("Leave")}</h1>
        {me && (
          <Link href={`/hr/${me}`} className="btn btn-small">
            {tr("My employee file")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Only working days (Monday to Friday) are counted.")}</p>
      <Notice {...notice} />

      {balance && (
        <div className="stat-grid">
          <div className="stat">
            <div className="n">{daysText(num(balance.left))}</div>
            <div className="l">
              {tr("Your annual leave left")} {balance.year}
            </div>
          </div>
          <div className="stat">
            <div className="n">{daysText(num(balance.taken))}</div>
            <div className="l">
              {tr("Days taken")} / {daysText(num(balance.entitled))}
            </div>
          </div>
          <div className={`stat ${num(balance.waiting) > 0 ? "alert" : ""}`}>
            <div className="n">{daysText(num(balance.waiting))}</div>
            <div className="l">{tr("Waiting for approval")}</div>
          </div>
        </div>
      )}

      {choosable.length > 0 ? (
        <form action={requestLeave} className="card" id="ask">
          <h2>{tr("Ask for leave")}</h2>
          <input type="hidden" name="back" value={back} />
          <div className="grid grid-2">
            {manager ? (
              <div className="field">
                <label htmlFor="employee_id">{tr("Employee")}</label>
                <select id="employee_id" name="employee_id" defaultValue={defaultEmployee}>
                  {choosable.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                      {e.id === me ? ` (${tr("me")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="employee_id" value={defaultEmployee} />
            )}
            <div className="field">
              <label htmlFor="kind">{tr("Kind of leave")}</label>
              <select id="kind" name="kind" defaultValue="annual">
                {Object.entries(LEAVE_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {tr(label)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="starts_on">{tr("First day")}</label>
              <input id="starts_on" name="starts_on" type="date" required defaultValue={addDays(today, 1)} />
            </div>
            <div className="field">
              <label htmlFor="ends_on">{tr("Last day")}</label>
              <input id="ends_on" name="ends_on" type="date" required defaultValue={addDays(today, 1)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="reason">{tr("Reason")}</label>
              <input id="reason" name="reason" type="text" maxLength={500} placeholder={tr("e.g. Family visit in Mbeya")} />
            </div>
          </div>
          <SubmitButton pendingText={tr("Sending…")}>{tr("Send request")}</SubmitButton>
        </form>
      ) : (
        <section className="card">
          <p>{tr("Management has not added your employee file yet.")}</p>
          <p className="muted small">{tr("Ask management to add it, then you can ask for leave here.")}</p>
        </section>
      )}

      {manager && (
        <>
          <section className="card">
            <h2>{tr("Who is away")}</h2>
            <p className="muted small">{tr("Approved leave today and in the next 14 days.")}</p>
            {away.length === 0 ? (
              <p className="muted small">{tr("Nobody is away.")}</p>
            ) : (
              <ul className="lines">{away.map((l) => item(l, { name: true, decide: false, cancel: false }))}</ul>
            )}
          </section>

          <section className="card">
            <h2>{tr("Team leave")}</h2>
            <nav className="tabs-row" aria-label={tr("Show")}>
              {TABS.map((t) => (
                <Link key={t.key} href={t.key === "waiting" ? "/hr/leave" : `/hr/leave?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
                  {tr(t.label)}
                </Link>
              ))}
            </nav>
            {team.length === 0 ? (
              <p className="muted small">{tab.key === "waiting" ? tr("No leave waiting for approval.") : tr("No leave here.")}</p>
            ) : (
              <ul className="lines">{team.map((l) => item(l, { name: true, decide: true, cancel: true }))}</ul>
            )}
          </section>
        </>
      )}

      {me && (
        <section className="card">
          <h2>{tr("My leave requests")}</h2>
          {mine.length === 0 ? (
            <p className="muted small">{tr("No leave requests yet.")}</p>
          ) : (
            <ul className="lines">{mine.map((l) => item(l, { name: false, decide: false, cancel: true }))}</ul>
          )}
        </section>
      )}
    </>
  );
}
