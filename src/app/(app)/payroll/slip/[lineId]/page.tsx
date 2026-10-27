import { primeLang, tr } from "@/lib/tr";
import { notFound } from "next/navigation";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { brandingUrl, getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { EMPLOYEE_PAY_METHODS, PAYROLL_STATUS, monthLabel, type PayrollLine } from "@/lib/payroll";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Payslip" };

type RunInfo = { period: string; pay_date: string | null; status: string; number?: string };

function Row({ label, value, strong, minus }: { label: string; value: string; strong?: boolean; minus?: boolean }) {
  return (
    <tr>
      <td>{strong ? <strong>{label}</strong> : label}</td>
      <td className="num">{strong ? <strong>{value}</strong> : minus ? `−${value}` : value}</td>
    </tr>
  );
}

export default async function PayslipPage({ params }: { params: Promise<{ lineId: string }> }) {
  await primeLang();
  const { lineId } = await params;
  const { supabase, company, roles } = await getAppContext();
  const { data, error } = await supabase.from("payroll_lines").select("*").eq("id", lineId).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Payslip" />;
  if (!data) notFound();
  const l = data as PayrollLine;
  const runner = can(roles, "runPayroll");

  // Management and finance read the run; an employee reads their own month through my_payslips.
  let run: RunInfo | null = null;
  if (runner) {
    const { data: r } = await supabase.from("payroll_runs").select("number, period, pay_date, status").eq("id", l.run_id).maybeSingle();
    run = (r as RunInfo | null) ?? null;
  }
  if (!run) {
    const { data: mine } = await supabase.rpc("my_payslips", { p_company: company.id });
    const m = ((mine ?? []) as { line_id: string; period: string; pay_date: string | null; status: string }[]).find((x) => x.line_id === lineId);
    if (m) run = { period: m.period, pay_date: m.pay_date, status: m.status };
  }
  if (!run) notFound();

  const base = company.base_currency;
  const money = (n: number | string) => formatMoney(Number(n), base);
  const logo = brandingUrl(supabase, company.logo_path);
  const deductions = Number(l.nssf_employee) + Number(l.paye) + Number(l.other_deductions);
  const employer = Number(l.nssf_employer) + Number(l.sdl) + Number(l.wcf);

  return (
    <>
      <BackLink href={runner ? `/payroll/${l.run_id}` : "/payroll/my"} label={runner ? "Pay run" : "My payslips"} />
      <div className="rep-actions no-print">
        <StatusBadge map={PAYROLL_STATUS} status={run.status} />
        <div className="rep-buttons">
          <PrintButton />
        </div>
      </div>
      <section className="card report-print" style={{ maxWidth: 720 }}>
        <div className="rep-head" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div className="rep-company">{company.legal_name || company.name}</div>
            {company.address && <p className="small muted">{company.address}</p>}
            {company.tin && (
              <p className="small muted">
                {tr("TIN")} {company.tin}
              </p>
            )}
          </div>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ maxHeight: 56, maxWidth: 160, objectFit: "contain" }} />
          )}
        </div>
        <h2 style={{ margin: "8px 0 4px" }}>
          {tr("Payslip")} · {monthLabel(run.period, tr)}
        </h2>
        <p className="small" style={{ margin: "2px 0" }}>
          <strong>{l.employee_name}</strong>
          {l.employee_no && ` · ${l.employee_no}`}
          {l.job_title && ` · ${l.job_title}`}
        </p>
        <p className="small muted" style={{ margin: "2px 0 12px" }}>
          {run.pay_date && `${tr("Pay date")} ${formatDate(run.pay_date)}`}
          {run.number && ` · ${run.number}`}
        </p>

        <table className="compare rep-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>{tr("Earnings")}</th>
              <th className="num">{base}</th>
            </tr>
          </thead>
          <tbody>
            <Row label={tr("Basic salary")} value={money(l.basic)} />
            {Number(l.allowances) > 0 && <Row label={tr("Allowances")} value={money(l.allowances)} />}
            {Number(l.overtime) > 0 && <Row label={`${tr("Overtime")} (${Number(l.overtime_hours)} ${tr("hours")})`} value={money(l.overtime)} />}
            {Number(l.bonus) > 0 && <Row label={tr("Bonus")} value={money(l.bonus)} />}
            {Number(l.unpaid_deduction) > 0 && (
              <Row label={`${tr("Less unpaid leave")} (${Number(l.unpaid_days)} ${tr("days")})`} value={money(l.unpaid_deduction)} minus />
            )}
            <Row label={tr("Gross pay")} value={money(l.gross)} strong />
          </tbody>
        </table>

        <table className="compare rep-table" style={{ width: "100%", marginTop: 12 }}>
          <thead>
            <tr>
              <th>{tr("Deductions")}</th>
              <th className="num">{base}</th>
            </tr>
          </thead>
          <tbody>
            <Row label={tr("NSSF (employee)")} value={money(l.nssf_employee)} />
            <Row label={tr("PAYE (income tax)")} value={money(l.paye)} />
            {Number(l.other_deductions) > 0 && <Row label={l.deduction_label || tr("Other deductions")} value={money(l.other_deductions)} />}
            <Row label={tr("Total deductions")} value={money(deductions)} strong />
          </tbody>
        </table>

        <table className="compare rep-table" style={{ width: "100%", marginTop: 12 }}>
          <tbody>
            <tr>
              <td>
                <strong style={{ fontSize: "1.1rem" }}>{tr("Net pay")}</strong>
              </td>
              <td className="num">
                <strong style={{ fontSize: "1.1rem" }}>{money(l.net)}</strong>
              </td>
            </tr>
            <tr>
              <td>{tr("Paid to")}</td>
              <td className="num">
                {l.pay_method ? tr(EMPLOYEE_PAY_METHODS[l.pay_method] ?? l.pay_method) : "—"}
                {l.pay_account && ` · ${l.pay_account}`}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="compare rep-table" style={{ width: "100%", marginTop: 12 }}>
          <thead>
            <tr>
              <th>{tr("Paid by the employer (not taken from your pay)")}</th>
              <th className="num">{base}</th>
            </tr>
          </thead>
          <tbody>
            <Row label={tr("NSSF (employer)")} value={money(l.nssf_employer)} />
            {Number(l.sdl) > 0 && <Row label={tr("SDL (skills development levy)")} value={money(l.sdl)} />}
            <Row label={tr("WCF (workers compensation)")} value={money(l.wcf)} />
            <Row label={tr("Total paid by the employer")} value={money(employer)} strong />
          </tbody>
        </table>
        {company.document_footer && <p className="small muted" style={{ marginTop: 12 }}>{company.document_footer}</p>}
      </section>
    </>
  );
}
