"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { canInvoiceService, canPlanService, checklistFromText, fromLocalInput, JOB_KINDS, JOB_PRIORITIES, LINE_KINDS, parseChecklist } from "@/lib/services";
import { hasRole } from "@/lib/roles";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

function money(form: FormData, key: string, path: string, label: string) {
  const v = toNumber(str(form, key));
  if (v === null) return null;
  if (Number.isNaN(v) || v < 0) fail(path, `${label} must be a number of zero or more.`);
  return v;
}

/** The fields shared by the new-job and edit forms. */
function jobValues(form: FormData, path: string) {
  const title = str(form, "title");
  if (title.length < 2) fail(path, "Give the job a short title, e.g. Install water pump.");
  const kind = str(form, "kind");
  const priority = str(form, "priority");
  const assigned = [...new Set(form.getAll("assigned_to").map(String).filter((v) => uuid(v)))];
  return {
    title,
    kind: kind in JOB_KINDS ? kind : "other",
    priority: priority in JOB_PRIORITIES ? priority : "normal",
    site: optional(form, "site"),
    contact: optional(form, "contact"),
    scheduled_for: fromLocalInput(str(form, "scheduled_for")),
    due_by: fromLocalInput(str(form, "due_by")),
    assigned_to: assigned,
    description: optional(form, "description"),
    price: money(form, "price", path, "The agreed price"),
    currency: /^[A-Z]{3}$/.test(str(form, "currency")) ? str(form, "currency") : "TZS",
    warehouse_id: uuid(optional(form, "warehouse_id")),
    equipment_id: uuid(optional(form, "equipment_id")),
    project_id: uuid(optional(form, "project_id")),
  };
}

export async function createJob(form: FormData) {
  const path = "/jobs/new";
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "Only management, sales and warehouse can create jobs.");
  const client = uuid(optional(form, "client_id"));
  if (!client) fail(path, "Choose the client.");
  const values = jobValues(form, path);
  const checklist = checklistFromText(str(form, "checklist")).map((text) => ({ text, done: false }));
  const { data, error } = await supabase
    .from("service_jobs")
    .insert({
      company_id: company.id,
      client_id: client,
      quotation_id: uuid(optional(form, "quotation_id")),
      contract_id: uuid(optional(form, "contract_id")),
      checklist,
      ...values,
    })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath("/jobs");
  redirect(withNotice(`/jobs/${data.id}`, { msg: "Job created. The technicians see it on their phones." }));
}

export async function saveJob(form: FormData) {
  const id = str(form, "id");
  const path = `/jobs/${id}#details`;
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "Only management, sales and warehouse can change jobs.");
  const values = jobValues(form, path);
  const { data, error } = await supabase.from("service_jobs").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: "Saved." }));
}

/** Start, hold, resume or cancel. */
export async function jobStatus(form: FormData) {
  const id = str(form, "id");
  const status = str(form, "status");
  const path = `/jobs/${id}`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("set_job_status", { p_job: id, p_status: status, p_reason: optional(form, "reason") });
  if (error) fail(path, error.message);
  revalidatePath("/jobs");
  revalidatePath(path);
  const msg =
    status === "in_progress" ? "Job started." : status === "on_hold" ? "Job on hold." : status === "cancelled" ? "Job cancelled." : "Saved.";
  redirect(withNotice(path, { msg }));
}

/** Ticks on the checklist, extra points and the findings. */
export async function saveProgress(form: FormData) {
  const id = str(form, "id");
  const path = `/jobs/${id}#checklist`;
  const { supabase } = await getAppContext();
  const { data: job } = await supabase.from("service_jobs").select("checklist").eq("id", id).maybeSingle();
  const done = new Set(form.getAll("done").map(String));
  const list = parseChecklist(job?.checklist).map((c, i) => ({ text: c.text, done: done.has(String(i)) }));
  for (const text of checklistFromText(str(form, "add_points"))) list.push({ text, done: false });
  const { error } = await supabase.rpc("update_job_progress", { p_job: id, p_checklist: list, p_findings: str(form, "findings") });
  if (error) fail(path, error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function addJobLine(form: FormData) {
  const id = str(form, "job_id");
  const path = `/jobs/${id}#lines`;
  const { supabase, company } = await getAppContext();
  const kind = str(form, "kind") in LINE_KINDS ? str(form, "kind") : "material";
  const productId = uuid(optional(form, "product_id"));
  const qty = toNumber(str(form, "quantity"));
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(path, "Enter a quantity above zero.");
  let description = str(form, "description");
  let unit = str(form, "unit");
  let price = money(form, "unit_price", path, "The price");
  let cost: number | null = null;
  if (productId) {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("products").select("name, unit, selling_price").eq("id", productId).eq("company_id", company.id).maybeSingle(),
      supabase.from("product_costs").select("last_cost").eq("product_id", productId).maybeSingle(),
    ]);
    if (!p) fail(path, "That item was not found.");
    description ||= p.name;
    unit ||= p.unit;
    if (price === null) price = p.selling_price ?? 0;
    cost = c?.last_cost ?? null;
  }
  if (!description) fail(path, "Choose an item or describe the work.");
  const { error } = await supabase.from("service_job_lines").insert({
    company_id: company.id,
    job_id: id,
    kind,
    product_id: productId,
    description: description.slice(0, 300),
    quantity: qty,
    unit: (unit || (kind === "labour" ? "hour" : "pcs")).slice(0, 20),
    unit_price: price ?? 0,
    unit_cost: cost,
  });
  if (error) fail(path, error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: kind === "material" ? "Material added. It leaves the store when the job is completed." : "Added." }));
}

export async function removeJobLine(form: FormData) {
  const id = str(form, "job_id");
  const path = `/jobs/${id}#lines`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("service_job_lines").delete().eq("id", str(form, "line_id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: "Removed." }));
}

/** Hours on the job go into the timesheets (management may record them for someone else). */
export async function addJobHours(form: FormData) {
  const id = str(form, "job_id");
  const path = `/jobs/${id}#hours`;
  const { supabase, company, roles, user } = await getAppContext();
  const hours = toNumber(str(form, "hours"));
  if (hours === null || Number.isNaN(hours) || hours <= 0 || hours > 24) fail(path, "Hours must be between 0 and 24.");
  const person = uuid(optional(form, "user_id"));
  const { error } = await supabase.from("timesheets").insert({
    company_id: company.id,
    user_id: hasRole(roles, "management") && person ? person : user.id,
    work_date: str(form, "work_date") || undefined,
    hours,
    job_id: id,
    description: optional(form, "description"),
    billable: str(form, "billable") !== "no",
  });
  if (error) fail(path, error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: "Hours recorded." }));
}

export async function removeJobHours(form: FormData) {
  const id = str(form, "job_id");
  const path = `/jobs/${id}#hours`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("timesheets").delete().eq("id", str(form, "entry_id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/jobs/${id}`);
  redirect(withNotice(path, { msg: "Removed." }));
}

/** Materials leave the store, the client's sign-off is kept and finance is told. */
export async function completeJob(form: FormData) {
  const id = str(form, "id");
  const path = `/jobs/${id}`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("complete_service_job", {
    p_job: id,
    p_findings: str(form, "findings"),
    p_signed_by: str(form, "signed_by"),
    p_signature_path: optional(form, "signature_path"),
  });
  if (error) fail(`${path}#finish`, error.message);
  revalidatePath("/jobs");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Job completed. Finance has been told it is ready to invoice." }));
}

export async function invoiceJob(form: FormData) {
  const id = str(form, "id");
  const path = `/jobs/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!canInvoiceService(roles)) fail(path, "Only management and finance can invoice jobs.");
  const { data, error } = await supabase.rpc("invoice_service_job", { p_job: id });
  if (error) fail(path, error.message);
  revalidatePath("/jobs");
  revalidatePath("/invoices");
  redirect(withNotice(`/invoices/${data}`, { msg: "Draft invoice made from the job. Check it and issue it." }));
}
