"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { payrollError } from "@/lib/payroll";
import { can } from "@/lib/roles";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(payrollError(error)) }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A number of zero or more; empty is zero. "bad" when it is not a number or negative. */
function amount(form: FormData, key: string): number | "bad" {
  const v = toNumber(str(form, key));
  if (v === null) return 0;
  return Number.isNaN(v) || v < 0 ? "bad" : v;
}

async function payrollContext(path: string) {
  const ctx = await getAppContext();
  if (!can(ctx.role, "runPayroll")) fail(path, "Only management or finance can run payroll.");
  return ctx;
}

// ---------------------------------------------------------------- pay runs

export async function createRun(form: FormData) {
  const path = "/payroll";
  const month = str(form, "month");
  if (!/^\d{4}-\d{2}$/.test(month)) fail(path, "Choose the month.");
  const payDate = str(form, "pay_date");
  if (payDate && !DATE.test(payDate)) fail(path, "Choose the pay date.");
  const { supabase, company } = await payrollContext(path);
  const { data, error } = await supabase.rpc("create_payroll_run", {
    p_company: company.id,
    p_period: `${month}-01`,
    p_pay_date: payDate || null,
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(`/payroll/${data as string}`, { msg: "Pay run created. Check each person, then approve it." }));
}

export async function updateLine(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const hours = amount(form, "overtime_hours");
  const bonus = amount(form, "bonus");
  const other = amount(form, "other_deductions");
  const unpaid = amount(form, "unpaid_days");
  if (hours === "bad" || bonus === "bad" || other === "bad" || unpaid === "bad") fail(path, "Amounts cannot be negative.");
  const { supabase } = await payrollContext(path);
  const { error } = await supabase.rpc("update_payroll_line", {
    p_line: str(form, "line_id"),
    p_overtime_hours: hours,
    p_bonus: bonus,
    p_other_deductions: other,
    p_unpaid_days: unpaid,
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Payslip updated." }));
}

export async function removeLine(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const { supabase } = await payrollContext(path);
  const { error } = await supabase.rpc("remove_payroll_line", { p_line: str(form, "line_id") });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Removed from this pay run." }));
}

export async function refreshRun(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const { supabase } = await payrollContext(path);
  const { error } = await supabase.rpc("refresh_payroll_run", { p_run: runId });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Pay run refreshed from pay details, leave and timesheets." }));
}

export async function approveRun(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const { supabase, role } = await payrollContext(path);
  if (role !== "management") fail(path, "Only management can approve payroll.");
  const { error } = await supabase.rpc("approve_payroll_run", { p_run: runId });
  if (error) fail(path, error.message);
  revalidatePath(path);
  revalidatePath("/payroll");
  redirect(withNotice(path, { msg: "Pay run approved and posted to the accounts. Payslips are now on each person's phone." }));
}

export async function cancelRun(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const { supabase } = await payrollContext(path);
  const { error } = await supabase.rpc("cancel_payroll_run", { p_run: runId });
  if (error) fail(path, error.message);
  revalidatePath(path);
  revalidatePath("/payroll");
  redirect(withNotice(path, { msg: "Pay run cancelled." }));
}

export async function payRun(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}`;
  const paidOn = str(form, "paid_on");
  if (paidOn && !DATE.test(paidOn)) fail(path, "Choose the date paid.");
  const { supabase } = await payrollContext(path);
  const { error } = await supabase.rpc("pay_payroll_run", {
    p_run: runId,
    p_paid_on: paidOn || null,
    p_method: str(form, "method") || "bank_transfer",
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
  revalidatePath("/payroll");
  redirect(withNotice(path, { msg: "Salaries marked as paid." }));
}

export async function payStatutory(form: FormData) {
  const runId = str(form, "run_id");
  const path = `/payroll/${runId}#statutory`;
  const value = amount(form, "amount");
  if (value === "bad" || value <= 0) fail(path, "Enter the amount paid.");
  const paidOn = str(form, "paid_on");
  if (paidOn && !DATE.test(paidOn)) fail(path, "Choose the date paid.");
  const reference = optional(form, "reference");
  if (reference && reference.length > 60) fail(path, "The reference is too long.");
  const { supabase, company } = await payrollContext(path);
  const { error } = await supabase.rpc("pay_statutory", {
    p_company: company.id,
    p_kind: str(form, "kind"),
    p_amount: value,
    p_paid_on: paidOn || null,
    p_method: str(form, "method") || "bank_transfer",
    p_reference: reference,
  });
  if (error) fail(path, error.message);
  revalidatePath(`/payroll/${runId}`);
  redirect(withNotice(path, { msg: "Payment recorded in the accounts." }));
}

// ---------------------------------------------------------------- pay details

export async function savePay(form: FormData) {
  const employeeId = str(form, "employee_id");
  const path = `/payroll/pay/${employeeId}`;
  const nums = {
    basic_salary: amount(form, "basic_salary"),
    housing_allowance: amount(form, "housing_allowance"),
    transport_allowance: amount(form, "transport_allowance"),
    other_allowance: amount(form, "other_allowance"),
    monthly_deduction: amount(form, "monthly_deduction"),
  };
  if (Object.values(nums).some((v) => v === "bad")) fail(path, "Amounts must be numbers of zero or more.");
  const method = str(form, "pay_method") || "bank_transfer";
  if (!["bank_transfer", "cash", "mobile_money"].includes(method)) fail(path, "Unknown payment method.");
  const label = optional(form, "deduction_label");
  const bankName = method === "bank_transfer" ? optional(form, "bank_name") : null;
  const bankAccount = method === "bank_transfer" ? optional(form, "bank_account") : null;
  const mobile = method === "mobile_money" ? optional(form, "mobile_number") : null;
  if ((label && label.length > 80) || (bankName && bankName.length > 80) || (bankAccount && bankAccount.length > 60) || (mobile && mobile.length > 30)) {
    fail(path, "Some details are too long.");
  }
  if (method === "bank_transfer" && !bankAccount) fail(path, "Enter the bank account number, or choose another way to pay.");
  if (method === "mobile_money" && !mobile) fail(path, "Enter the mobile money number, or choose another way to pay.");
  const values = {
    ...(nums as Record<string, number>),
    deduction_label: label,
    nssf_member: str(form, "nssf_member") === "on",
    paye_exempt: str(form, "paye_exempt") === "on",
    pays_overtime: str(form, "pays_overtime") === "on",
    pay_method: method,
    bank_name: bankName,
    bank_account: bankAccount,
    mobile_number: mobile,
  };
  const { supabase, company } = await payrollContext(path);
  // Insert or update by hand: an upsert would also update employee_id and company_id, which are not granted for update.
  const { data: existing, error: readError } = await supabase
    .from("employee_pay")
    .select("employee_id")
    .eq("company_id", company.id)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (readError) fail(path, readError.message);
  const { error } = existing
    ? await supabase.from("employee_pay").update(values).eq("company_id", company.id).eq("employee_id", employeeId)
    : await supabase.from("employee_pay").insert({ employee_id: employeeId, company_id: company.id, ...values });
  if (error) fail(path, error.message);
  revalidatePath("/payroll/pay");
  revalidatePath(path);
  redirect(withNotice("/payroll/pay", { msg: "Pay details saved. Draft pay runs pick them up when you refresh them." }));
}

// ---------------------------------------------------------------- settings

export async function saveSettings(form: FormData) {
  const path = "/payroll/settings";
  const { supabase, company, role } = await getAppContext();
  if (role !== "management") fail(path, "Only management can change payroll rates.");

  const bands: { from: number; rate: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const fromRaw = str(form, `band_from_${i}`);
    const rateRaw = str(form, `band_rate_${i}`);
    if (!fromRaw && !rateRaw) continue;
    const from = toNumber(fromRaw);
    const rate = toNumber(rateRaw);
    if (from === null || rate === null || Number.isNaN(from) || Number.isNaN(rate) || from < 0 || rate < 0 || rate > 100) {
      fail(path, "Each tax band needs a starting amount and a rate between 0 and 100.");
    }
    bands.push({ from, rate });
  }
  if (bands.length === 0) fail(path, "Each tax band needs a starting amount and a rate between 0 and 100.");
  bands.sort((a, b) => a.from - b.from);

  const settings: Record<string, unknown> = { paye_bands: bands };
  const fields: [string, number, number][] = [
    ["nssf_employee_pct", 0, 50],
    ["nssf_employer_pct", 0, 50],
    ["sdl_pct", 0, 20],
    ["sdl_min_employees", 0, 10000],
    ["wcf_pct", 0, 20],
    ["overtime_after_hours", 0, 168],
    ["overtime_factor", 1, 5],
    ["monthly_hours", 1, 744],
  ];
  for (const [key, min, max] of fields) {
    const v = toNumber(str(form, key));
    if (v === null) continue;
    if (Number.isNaN(v) || v < min || v > max) fail(path, "Check the rates: one of them is out of range.");
    settings[key] = key === "sdl_min_employees" ? Math.round(v) : v;
  }
  const { error } = await supabase.rpc("save_payroll_settings", { p_company: company.id, p_settings: settings });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Payroll rates saved. New and refreshed pay runs use them." }));
}
