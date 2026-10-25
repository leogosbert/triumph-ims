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
import { addDays, canSeeCompliance, canWriteItem, DEADLINE_FIELDS, DEADLINE_STATUS, periodLabel, type Deadline } from "@/lib/compliance/model";
import { effectiveDue, lateFilingPenalty, legalRules, monthsLate } from "@/lib/compliance/rules";
import { StatusBadge } from "@/lib/sales";
import { todayTz } from "@/lib/services";
import { markFiled, reopenFiling, skipFiling } from "../actions";
import { ComplianceTabs, Disclaimer } from "../parts";

export const metadata = { title: "Tax & filing calendar" };

type Row = Deadline & {
  item: { id: string; name: string; code: string | null; category: string; finance_ok: boolean; status: string; authority: string | null } | null;
  due: string;
};
type Run = { period: string; paye: number; sdl: number; nssf_employee: number; nssf_employer: number; wcf: number };

/** What the app already knows about the amount of a filing (payroll for PAYE/SDL/NSSF/WCF, invoices for VAT). */
function guessAmount(r: Row, runs: Map<string, Run>, vat: Map<string, number>): { amount: number; from: string } | null {
  const code = r.item?.code;
  const month = r.period_start.slice(0, 7);
  if (r.period_start.slice(0, 7) !== r.period_end.slice(0, 7)) return null;
  const run = runs.get(month);
  if (run) {
    if (code === "TRA_PAYE") return { amount: Number(run.paye), from: "payroll" };
    if (code === "TRA_SDL") return { amount: Number(run.sdl), from: "payroll" };
    if (code === "NSSF_CONTRIBUTIONS") return { amount: Number(run.nssf_employee) + Number(run.nssf_employer), from: "payroll" };
    if (code === "WCF_CONTRIBUTIONS") return { amount: Number(run.wcf), from: "payroll" };
  }
  if (code === "TRA_VAT_RETURN" && vat.has(month)) return { amount: vat.get(month) ?? 0, from: "output VAT on invoices, before input VAT" };
  return null;
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");
  const refresh = await supabase.rpc("compliance_refresh_calendar", { p_company: company.id });
  if (isMissingTable(refresh.error)) return <NotReady title="Tax & filing calendar" />;

  const today = todayTz();
  const until = addDays(today, 100);
  const select = `${DEADLINE_FIELDS}, item:compliance_items!inner(id, name, code, category, finance_ok, status, authority)`;
  const [openRes, doneRes, setRes] = await Promise.all([
    supabase.from("compliance_deadlines").select(select).eq("company_id", company.id).eq("status", "open").neq("item.status", "not_applicable").lte("due_on", until).order("due_on").limit(300),
    supabase.from("compliance_deadlines").select(select).eq("company_id", company.id).neq("status", "open").order("filed_at", { ascending: false }).limit(20),
    supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle(),
  ]);
  if (isMissingTable(openRes.error)) return <NotReady title="Tax & filing calendar" />;
  if (openRes.error) throw new Error(openRes.error.message);
  const rules = legalRules(setRes.data?.legal_rules);
  const withDue = (rows: unknown) => ((rows ?? []) as Row[]).map((r) => ({ ...r, due: effectiveDue(r.due_on, rules) }));
  const open = withDue(openRes.data);
  const filed = withDue(doneRes.data);

  // Amounts the app can suggest: payroll (management and finance can read it) and VAT on invoices.
  const months = [...new Set(open.map((r) => r.period_start.slice(0, 7)))];
  const runs = new Map<string, Run>();
  const vat = new Map<string, number>();
  if (months.length && (role === "management" || role === "finance")) {
    const first = `${months.reduce((a, b) => (a < b ? a : b))}-01`;
    const [runRes, invRes] = await Promise.all([
      supabase.from("payroll_runs").select("period, paye, sdl, nssf_employee, nssf_employer, wcf").eq("company_id", company.id).in("status", ["approved", "paid"]).gte("period", first).limit(200),
      supabase.from("invoices").select("issue_date, vat_amount, exchange_rate").eq("company_id", company.id).in("status", ["issued", "partly_paid", "paid"]).gte("issue_date", first).limit(20000),
    ]);
    for (const r of (runRes.data ?? []) as Run[]) runs.set(r.period.slice(0, 7), r);
    for (const i of (invRes.data ?? []) as { issue_date: string; vat_amount: number; exchange_rate: number }[]) {
      const m = i.issue_date.slice(0, 7);
      vat.set(m, (vat.get(m) ?? 0) + Number(i.vat_amount) * Number(i.exchange_rate || 1));
    }
  }

  const overdue = open.filter((r) => r.due < today);
  const soon = open.filter((r) => r.due >= today && r.due <= addDays(today, 30));
  const later = open.filter((r) => r.due > addDays(today, 30));

  const filingForm = (r: Row) => {
    const write = canWriteItem(role, !!r.item?.finance_ok);
    const guess = guessAmount(r, runs, vat);
    const late = r.due < today ? monthsLate(r.due, today) : 0;
    const isTax = r.item?.category === "tax";
    return (
      <li key={r.id}>
        <div className="line-head" style={{ alignItems: "flex-start" }}>
          <span>
            <Link href={`/compliance/checklist/${r.item?.id ?? ""}`} className="desc">
              {r.item ? tr(r.item.name) : ""}
            </Link>
            <br />
            <span className="small muted">
              {periodLabel(r.period_start, r.period_end)} · {tr("due")} {formatDate(r.due)}
              {r.due !== r.due_on && ` (${tr("moved from")} ${formatDate(r.due_on)})`}
              {r.item?.authority && ` · ${tr(r.item.authority)}`}
            </span>
          </span>
          <span className={`badge tone-${r.due < today ? "bad" : r.due <= addDays(today, 7) ? "warn" : "info"}`}>
            {r.due < today ? tr("Overdue") : r.due === today ? tr("Today") : formatDate(r.due)}
          </span>
        </div>
        {late > 0 && isTax && (
          <p className="small text-warn" style={{ margin: "4px 0" }}>
            {tr("Estimated late filing penalty")}: {formatMoney(lateFilingPenalty(guess?.amount ?? 0, rules) * late)} ({late} {late === 1 ? tr("month") : tr("months")}) ·{" "}
            <Link href="/compliance/rules">{tr("rule")}</Link>
          </p>
        )}
        {write && (
          <details style={{ marginTop: 4 }}>
            <summary className="small">{tr("Mark done")}</summary>
            <form action={markFiled} className="grid grid-2" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={r.id} />
              <div className="field">
                <label htmlFor={`filed_on_${r.id}`}>{tr("Filed on")}</label>
                <input id={`filed_on_${r.id}`} name="filed_on" type="date" max={today} defaultValue={today} />
              </div>
              <div className="field">
                <label htmlFor={`amount_${r.id}`}>
                  {tr("Amount")} {guess && <span className="hint">· {tr("from")} {tr(guess.from)}</span>}
                </label>
                <input id={`amount_${r.id}`} name="amount" type="number" min={0} step="0.01" defaultValue={guess ? Math.round(guess.amount * 100) / 100 : ""} />
              </div>
              <div className="field">
                <label htmlFor={`control_${r.id}`}>{tr("Control number")}</label>
                <input id={`control_${r.id}`} name="control_number" type="text" maxLength={60} inputMode="numeric" />
              </div>
              <div className="field">
                <label htmlFor={`paid_on_${r.id}`}>{tr("Paid on")}</label>
                <input id={`paid_on_${r.id}`} name="paid_on" type="date" max={today} />
              </div>
              <div className="field">
                <label htmlFor={`reference_${r.id}`}>{tr("Acknowledgement or receipt no.")}</label>
                <input id={`reference_${r.id}`} name="reference" type="text" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor={`note_${r.id}`}>{tr("Note")}</label>
                <input id={`note_${r.id}`} name="note" type="text" maxLength={500} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <SubmitButton className="btn btn-primary btn-small">{tr("Mark filed")}</SubmitButton>
              </div>
            </form>
            <form action={skipFiling} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              <input type="hidden" name="id" value={r.id} />
              <div className="field" style={{ flex: "1 1 200px", margin: 0 }}>
                <label htmlFor={`skip_${r.id}`}>{tr("Nothing to file? Say why")}</label>
                <input id={`skip_${r.id}`} name="note" type="text" maxLength={500} required placeholder={tr("e.g. no salaries paid that month")} />
              </div>
              <SubmitButton className="btn btn-small">{tr("Nothing to file")}</SubmitButton>
            </form>
          </details>
        )}
      </li>
    );
  };

  const section = (title: string, rows: Row[], empty?: string) =>
    rows.length > 0 || empty ? (
      <section className="card">
        <h2>
          {tr(title)} {rows.length > 0 && <span className="small muted">({rows.length})</span>}
        </h2>
        {rows.length ? <ul className="lines">{rows.map(filingForm)}</ul> : <p className="small muted">{tr(empty ?? "")}</p>}
      </section>
    ) : null;

  return (
    <>
      <h1>{tr("Tax & filing calendar")}</h1>
      <ComplianceTabs current="/compliance/calendar" />
      <p className="muted small">
        {tr("Every return and payment on your checklist that repeats: PAYE and SDL, VAT, NSSF and WCF, provisional tax, the final return, BRELA annual return. Reminders go to management and finance before each due date.")}
        {rules.next_working_day && ` ${tr("A due date on a weekend or public holiday is shown on the next working day; Eid and Maulid are not counted, so file before them to be safe.")}`}
      </p>
      <Notice {...notice} />
      {open.length === 0 && filed.length === 0 ? (
        <section className="card">
          <p>{tr("Nothing on the calendar yet. Add the tax and social-security filings to your checklist and they appear here.")}</p>
          <Link href="/compliance/checklist/adopt" className="btn btn-small">
            {tr("+ From the catalogue")}
          </Link>
        </section>
      ) : (
        <>
          {section("Overdue", overdue)}
          {section("Due in the next 30 days", soon, "Nothing due in the next 30 days.")}
          {section("Later", later)}
          {filed.length > 0 && (
            <section className="card">
              <h2>{tr("Recently filed")}</h2>
              <ul className="lines">
                {filed.map((r) => (
                  <li key={r.id}>
                    <div className="line-head" style={{ alignItems: "flex-start" }}>
                      <span>
                        <span className="desc">{r.item ? tr(r.item.name) : ""}</span>
                        <br />
                        <span className="small muted">
                          {periodLabel(r.period_start, r.period_end)}
                          {r.filed_on && ` · ${tr("filed")} ${formatDate(r.filed_on)}`}
                          {r.filed_on && r.filed_on > r.due && ` (${tr("late")})`}
                          {r.amount !== null && ` · ${formatMoney(r.amount)}`}
                          {r.control_number && ` · ${tr("control no.")} ${r.control_number}`}
                          {r.paid_on && ` · ${tr("paid")} ${formatDate(r.paid_on)}`}
                          {r.reference && ` · ${r.reference}`}
                          {r.note && ` · ${r.note}`}
                        </span>
                      </span>
                      <StatusBadge map={DEADLINE_STATUS} status={r.status} />
                    </div>
                    {canWriteItem(role, !!r.item?.finance_ok) && (
                      <form action={reopenFiling} style={{ marginTop: 4 }}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn btn-small" pendingText="…">
                          {tr("Open again")}
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <Disclaimer compact />
    </>
  );
}
