import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { EMPLOYEE_PAY_METHODS } from "@/lib/payroll";
import { can } from "@/lib/roles";

export const metadata = { title: "Pay details" };

type Emp = { id: string; employee_no: string; full_name: string; job_title: string | null; department: string | null };
type Pay = { employee_id: string; basic_salary: number; housing_allowance: number; transport_allowance: number; other_allowance: number; pay_method: string };

export default async function PayDetailsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "runPayroll")) redirect("/payroll/my");
  const [{ data: empData, error: empError }, { data: payData, error: payError }] = await Promise.all([
    supabase.from("employees").select("id, employee_no, full_name, job_title, department").eq("company_id", company.id).eq("status", "active").order("full_name"),
    supabase.from("employee_pay").select("employee_id, basic_salary, housing_allowance, transport_allowance, other_allowance, pay_method").eq("company_id", company.id),
  ]);
  if (isMissingTable(empError) || isMissingTable(payError)) return <NotReady title="Pay details" />;
  if (empError) throw new Error(empError.message);
  const employees = (empData ?? []) as Emp[];
  const pay = new Map(((payData ?? []) as Pay[]).map((p) => [p.employee_id, p]));
  const missing = employees.filter((e) => !pay.has(e.id)).length;
  const base = company.base_currency;

  return (
    <>
      <p className="small">
        <Link href="/payroll">{tr("← Payroll")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Pay details")}</h1>
      </div>
      <p className="muted small">{tr("Each employee's basic salary, allowances, monthly deduction and how they are paid. Only management and finance see this.")}</p>
      <Notice {...notice} />
      {employees.length === 0 ? (
        <div className="card">
          <p className="muted">{tr("No employees yet. Management adds employees first, then you enter their pay here.")}</p>
          {role === "management" && (
            <Link href="/hr" className="btn btn-primary">
              {tr("Go to employees")}
            </Link>
          )}
        </div>
      ) : (
        <>
          {missing > 0 && (
            <p className="banner warn small">
              {missing === 1 ? tr("1 employee has no pay details yet and will not be paid.") : `${missing} ${tr("employees have no pay details yet and will not be paid.")}`}
            </p>
          )}
          <ul className="rec-list">
            {employees.map((e) => {
              const p = pay.get(e.id);
              const allowances = p ? Number(p.housing_allowance) + Number(p.transport_allowance) + Number(p.other_allowance) : 0;
              return (
                <li key={e.id}>
                  <Link href={`/payroll/pay/${e.id}`}>
                    <div className="main">
                      <div className="title">{e.full_name}</div>
                      <div className="sub">
                        {[e.employee_no, e.job_title, e.department].filter(Boolean).join(" · ")}
                        {p && ` · ${tr(EMPLOYEE_PAY_METHODS[p.pay_method] ?? p.pay_method)}`}
                      </div>
                    </div>
                    <div className="side">
                      {p ? (
                        <>
                          <div className="small">
                            <strong>{formatMoney(p.basic_salary, base)}</strong>
                          </div>
                          {allowances > 0 && (
                            <div className="muted small">
                              + {formatMoney(allowances, base)} {tr("allowances")}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="badge tone-warn">{tr("Not set")}</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
