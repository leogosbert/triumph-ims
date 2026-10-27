"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str, choice, LOST_CHOICE } from "@/lib/format";
import { EMPLOYMENT_TYPES, LEAVE_KINDS } from "@/lib/hr";
import { friendlyError, withNotice } from "@/lib/messages";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(hrError(error)) }));
}

function hrError(message: string): string {
  if (/employees_no_key/.test(message)) return "That employee number is already used.";
  if (/employees_user_key/.test(message)) return "That login is already linked to another employee.";
  if (/employees_check|probation_end|contract_end/.test(message) && /check constraint/.test(message))
    return "Probation, contract and leaving dates must be after the start date.";
  if (/employee_certificates_check/.test(message)) return "The expiry date must be after the issue date.";
  if (/full_name/.test(message) && /check constraint/.test(message)) return "Enter the full name (2 to 120 letters).";
  return message;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function employeeValues(form: FormData, path: string) {
  const fullName = str(form, "full_name");
  if (fullName.length < 2) fail(path, "Enter the full name (2 to 120 letters).");
  const leave = toNumber(str(form, "annual_leave_days"));
  if (leave !== null && (Number.isNaN(leave) || leave < 0 || leave > 365)) fail(path, "Annual leave days must be a number from 0 to 365.");
  const type = str(form, "employment_type");
  return {
    employee_no: str(form, "employee_no"),
    user_id: optional(form, "user_id"),
    full_name: fullName,
    job_title: optional(form, "job_title"),
    department: optional(form, "department"),
    employment_type: type in EMPLOYMENT_TYPES ? type : "permanent",
    start_date: optional(form, "start_date"),
    probation_end: optional(form, "probation_end"),
    contract_end: optional(form, "contract_end"),
    phone: optional(form, "phone"),
    email: optional(form, "email"),
    emergency_contact: optional(form, "emergency_contact"),
    emergency_phone: optional(form, "emergency_phone"),
    id_number: optional(form, "id_number"),
    tin: optional(form, "tin"),
    nssf_no: optional(form, "nssf_no"),
    annual_leave_days: leave === null ? 28 : Math.round(leave * 10) / 10,
    notes: optional(form, "notes"),
  };
}

export async function createEmployee(form: FormData) {
  const path = "/hr/new";
  const values = employeeValues(form, path);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) fail(path, "Only management can change this.");
  const { data, error } = await supabase
    .from("employees")
    .insert({ company_id: company.id, ...values })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath("/hr");
  redirect(withNotice(`/hr/${data.id}`, { msg: "Employee added." }));
}

export async function saveEmployee(form: FormData) {
  const id = str(form, "id");
  const path = `/hr/${id}`;
  const values = employeeValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("employees").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hr");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setEmployeeStatus(form: FormData) {
  const id = str(form, "id");
  const path = `/hr/${id}`;
  const status = str(form, "status") === "left" ? "left" : "active";
  const date = str(form, "date");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("set_employee_status", {
    p_employee: id,
    p_status: status,
    p_date: isDate(date) ? date : null,
    p_reason: optional(form, "reason"),
  });
  if (error) fail(path, error.message);
  revalidatePath("/hr");
  revalidatePath(path);
  redirect(withNotice(path, { msg: status === "left" ? "Marked as left." : "Welcome back: the employee is active again." }));
}

export async function addCertificate(form: FormData) {
  const id = str(form, "employee_id");
  const path = `/hr/${id}#certificates`;
  const name = str(form, "name");
  if (name.length < 2) fail(path, "Enter the name of the certificate or licence.");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("employee_certificates").insert({
    company_id: company.id,
    employee_id: id,
    name,
    issuer: optional(form, "issuer"),
    number: optional(form, "number"),
    issued_on: optional(form, "issued_on"),
    expires_on: optional(form, "expires_on"),
    notes: optional(form, "notes"),
  });
  if (error) fail(path, error.message);
  revalidatePath(`/hr/${id}`);
  revalidatePath("/hr");
  redirect(withNotice(path, { msg: "Certificate added." }));
}

export async function removeCertificate(form: FormData) {
  const id = str(form, "employee_id");
  const path = `/hr/${id}#certificates`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("employee_certificates")
    .delete()
    .eq("id", str(form, "certificate_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/hr/${id}`);
  revalidatePath("/hr");
  redirect(withNotice(path, { msg: "Removed." }));
}

function backTo(form: FormData, fallback: string) {
  const b = str(form, "back");
  return b.startsWith("/hr") ? b : fallback;
}

export async function requestLeave(form: FormData) {
  const path = backTo(form, "/hr/leave");
  const from = str(form, "starts_on");
  const to = str(form, "ends_on");
  if (!isDate(from) || !isDate(to) || to < from) fail(path, "Choose the first and last day of leave.");
  const kind = str(form, "kind");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("request_leave", {
    p_employee: str(form, "employee_id"),
    p_kind: kind in LEAVE_KINDS ? kind : "annual",
    p_from: from,
    p_to: to,
    p_reason: optional(form, "reason"),
  });
  if (error) fail(path, error.message);
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  redirect(withNotice(path, { msg: "Leave request sent to management." }));
}

export async function decideLeave(form: FormData) {
  const path = backTo(form, "/hr/leave");
  const approve = choice(form, "decision", "approve", "decline");
  if (approve === null) fail(path, LOST_CHOICE);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("decide_leave", {
    p_request: str(form, "request_id"),
    p_approve: approve,
    p_note: optional(form, "note"),
  });
  if (error) fail(path, error.message);
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  redirect(withNotice(path, { msg: approve ? "Leave approved." : "Leave declined." }));
}

export async function cancelLeave(form: FormData) {
  const path = backTo(form, "/hr/leave");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("cancel_leave", { p_request: str(form, "request_id") });
  if (error) fail(path, error.message);
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
  redirect(withNotice(path, { msg: "Leave cancelled." }));
}
