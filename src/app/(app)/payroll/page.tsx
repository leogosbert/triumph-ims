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
import { PAYROLL_STATUS, monthLabel, type PayrollRun } from "@/lib/payroll";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { createRun } from "./actions";

export const metadata = { title: "Payroll" };

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "runPayroll")) redirect("/payroll/my");
  const [{ data, error }, { count: payCount, error: payError }] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("id, number, period, status, pay_date, employees, gross, nssf_employee, paye, deductions, net, nssf_employer, sdl, wcf, approved_at, paid_at, paid_method")
      .eq("company_id", company.id)
      .order("period", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(120),
    supabase.from("employee_pay").select("employee_id", { count: "exact", head: true }).eq("company_id", company.id),
  ]);
  if (isMissingTable(error) || isMissingTable(payError)) return <NotReady title="Payroll" />;
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as PayrollRun[];
  const base = company.base_currency;
  const today = todayTz();
  const thisMonth = today.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const open = runs.filter((r) => r.status === "draft" || r.status === "approved");

  return (
    <>
      <div className="page-head">
        <h1>{tr("Payroll")}</h1>
      </div>
      <p className="muted small">{tr("Monthly pay with PAYE, NSSF, SDL and WCF worked out for you, payslips on each person's phone, and the journals posted to the accounts.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Payroll")}>
        <Link href="/payroll" aria-current="page">
          {tr("Pay runs")}
        </Link>
        <Link href="/payroll/pay">{tr("Pay details")}</Link>
        <Link href="/payroll/settings">{tr("Rates & settings")}</Link>
        <Link href="/payroll/my">{tr("My payslips")}</Link>
      </nav>

      {!payCount ? (
        <div className="card">
          <h2>{tr("Start with pay details")}</h2>
          <p className="muted small">{tr("No employee has pay details yet. Enter each person's basic salary, allowances and how they are paid, then run the month.")}</p>
          <Link href="/payroll/pay" className="btn btn-primary">
            {tr("Enter pay details")}
          </Link>
        </div>
      ) : (
        <form action={createRun} className="card">
          <h2>{tr("New pay run")}</h2>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="month">{tr("Month")}</label>
              <input id="month" name="month" type="month" defaultValue={thisMonth} required />
            </div>
            <div className="field">
              <label htmlFor="pay_date">{tr("Pay date")}</label>
              <input id="pay_date" name="pay_date" type="date" defaultValue={lastDay} />
            </div>
          </div>
          <p className="muted small">{tr("Everyone with pay details who works in that month is added. Overtime from approved timesheets and unpaid leave are filled in.")}</p>
          <SubmitButton pendingText={tr("Working it out…")}>{tr("Create pay run")}</SubmitButton>
        </form>
      )}

      {open.length > 0 && (
        <p className="banner warn small">
          {open.length === 1 ? tr("1 pay run is waiting to be approved or paid.") : `${open.length} ${tr("pay runs are waiting to be approved or paid.")}`}
        </p>
      )}

      <h2>{tr("Pay runs")}</h2>
      {runs.length === 0 ? (
        <p className="card muted">{tr("No pay runs yet. Create one for this month above.")}</p>
      ) : (
        <ul className="rec-list">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/payroll/${r.id}`}>
                <div className="main">
                  <div className="title">{monthLabel(r.period, tr)}</div>
                  <div className="sub">
                    {r.number} · {r.employees} {r.employees === 1 ? tr("person") : tr("people")}
                    {r.pay_date && ` · ${tr("pay date")} ${formatDate(r.pay_date)}`}
                  </div>
                  <div className="sub">
                    {tr("Gross")} {formatMoney(r.gross, base)} · {tr("PAYE")} {formatMoney(r.paye, base)}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={PAYROLL_STATUS} status={r.status} />
                  <div className="small">
                    <strong>{formatMoney(r.net, base)}</strong>
                  </div>
                  <div className="muted small">{tr("net")}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
