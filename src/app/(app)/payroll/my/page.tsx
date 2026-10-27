import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { PAYROLL_STATUS, monthLabel } from "@/lib/payroll";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "My payslips" };

type Slip = { line_id: string; run_id: string; period: string; pay_date: string | null; status: string; gross: number; net: number };

export default async function MyPayslipsPage() {
  await primeLang();
  const { supabase, company, roles } = await getAppContext();
  const { data, error } = await supabase.rpc("my_payslips", { p_company: company.id });
  if (error && (isMissingTable(error) || error.code === "PGRST202" || /function .* does not exist|Could not find the function/i.test(error.message))) {
    return <NotReady title="My payslips" />;
  }
  if (error) throw new Error(error.message);
  const slips = (data ?? []) as Slip[];
  const base = company.base_currency;

  return (
    <>
      {can(roles, "runPayroll") && (
        <BackLink href="/payroll" label="Payroll" />
      )}
      <div className="page-head">
        <h1>{tr("My payslips")}</h1>
      </div>
      <p className="muted small">{tr("Your monthly payslips appear here once management has approved the pay run.")}</p>
      {slips.length === 0 ? (
        <div className="card">
          <p className="muted">{tr("No payslips yet. When your company runs payroll and you are linked to your employee record, your payslips will show here.")}</p>
        </div>
      ) : (
        <ul className="rec-list">
          {slips.map((s) => (
            <li key={s.line_id}>
              <Link href={`/payroll/slip/${s.line_id}`}>
                <div className="main">
                  <div className="title">{monthLabel(s.period, tr)}</div>
                  <div className="sub">
                    {tr("Gross")} {formatMoney(s.gross, base)}
                    {s.pay_date && ` · ${tr("pay date")} ${formatDate(s.pay_date)}`}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={PAYROLL_STATUS} status={s.status} />
                  <div className="small">
                    <strong>{formatMoney(s.net, base)}</strong>
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
