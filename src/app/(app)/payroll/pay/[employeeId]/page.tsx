import { primeLang, tr } from "@/lib/tr";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { readSettings } from "@/lib/payroll";
import { can } from "@/lib/roles";
import { savePay } from "../../actions";
import { PayForm, type PayValues } from "./PayForm";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Pay details" };

export default async function EmployeePayPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { employeeId } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "runPayroll")) redirect("/payroll/my");
  const [{ data: emp, error: empError }, { data: payRow, error: payError }, { data: settingsRow }, { count: staff }] = await Promise.all([
    supabase.from("employees").select("id, employee_no, full_name, job_title, status, tin, nssf_no").eq("id", employeeId).eq("company_id", company.id).maybeSingle(),
    supabase.from("employee_pay").select("*").eq("employee_id", employeeId).eq("company_id", company.id).maybeSingle(),
    supabase.from("payroll_settings").select("*").eq("company_id", company.id).maybeSingle(),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "active"),
  ]);
  if (isMissingTable(empError) || isMissingTable(payError)) return <NotReady title="Pay details" />;
  if (!emp) notFound();
  const e = emp as { id: string; employee_no: string; full_name: string; job_title: string | null; status: string; tin: string | null; nssf_no: string | null };
  const settings = readSettings(settingsRow as Record<string, unknown> | null);
  const p = (payRow ?? null) as Record<string, unknown> | null;
  const n = (k: string) => Number(p?.[k] ?? 0);
  const initial: PayValues = {
    basic_salary: n("basic_salary"),
    housing_allowance: n("housing_allowance"),
    transport_allowance: n("transport_allowance"),
    other_allowance: n("other_allowance"),
    monthly_deduction: n("monthly_deduction"),
    deduction_label: (p?.deduction_label as string | null) ?? "",
    nssf_member: p ? Boolean(p.nssf_member) : true,
    paye_exempt: p ? Boolean(p.paye_exempt) : false,
    pays_overtime: p ? Boolean(p.pays_overtime) : true,
    pay_method: (p?.pay_method as string) ?? "bank_transfer",
    bank_name: (p?.bank_name as string | null) ?? "",
    bank_account: (p?.bank_account as string | null) ?? "",
    mobile_number: (p?.mobile_number as string | null) ?? "",
  };

  return (
    <>
      <BackLink href="/payroll/pay" label="Pay details" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{e.full_name}</h1>
        {!p && <span className="badge tone-warn">{tr("Not set")}</span>}
      </div>
      <p className="muted small">
        {[e.employee_no, e.job_title].filter(Boolean).join(" · ")}
        {` · ${tr("TIN")} ${e.tin || "—"} · ${tr("NSSF no.")} ${e.nssf_no || "—"}`}
      </p>
      {(!e.tin || !e.nssf_no) && <p className="banner warn small">{tr("The TIN or NSSF number is missing. Add it on the employee file so the PAYE and NSSF lists are complete.")}</p>}
      <Notice {...notice} />
      <PayForm
        action={savePay}
        employeeId={e.id}
        initial={initial}
        settings={settings}
        sdlApplies={(staff ?? 0) >= settings.sdl_min_employees}
        currency={company.base_currency}
      />
    </>
  );
}
