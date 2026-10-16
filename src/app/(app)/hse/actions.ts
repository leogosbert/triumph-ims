"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { hseError, sourcePath, INCIDENT_KINDS, INSPECTION_KINDS, INSPECTION_RESULTS, SEVERITIES } from "@/lib/hse";
import { friendlyError, withNotice } from "@/lib/messages";
import { fromLocalInput } from "@/lib/services";

/** withNotice, keeping a "#section" at the end of the address. */
function noticeUrl(path: string, notice: { msg?: string; error?: string }) {
  const [base, hash] = path.split("#");
  return withNotice(base, notice) + (hash ? `#${hash}` : "");
}

function fail(path: string, error: string): never {
  redirect(noticeUrl(path, { error: friendlyError(hseError(error)) }));
}

function pick(value: string, list: Record<string, unknown>, fallback: string) {
  return value in list ? value : fallback;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

function incidentValues(form: FormData, path: string) {
  const when = fromLocalInput(str(form, "occurred_at"));
  if (!when) fail(path, "Enter the date and time it happened.");
  const title = str(form, "title");
  if (title.length < 3 || title.length > 160) fail(path, "The title must be 3 to 160 characters.");
  const description = str(form, "description");
  if (description.length < 3) fail(path, "Say what happened (at least 3 characters).");
  const lost = toNumber(str(form, "lost_days"));
  if (lost !== null && (Number.isNaN(lost) || lost < 0)) fail(path, "Lost days must be a number of zero or more.");
  return {
    occurred_at: when,
    site: optional(form, "site"),
    kind: pick(str(form, "kind"), INCIDENT_KINDS, "near_miss"),
    severity: pick(str(form, "severity"), SEVERITIES, "low"),
    title,
    description,
    people_involved: optional(form, "people_involved"),
    immediate_action: optional(form, "immediate_action"),
    lost_days: lost ?? 0,
    // Only sent when the form showed the select (the person can see that list).
    ...(form.has("employee_id") ? { employee_id: optional(form, "employee_id") } : {}),
    ...(form.has("client_id") ? { client_id: optional(form, "client_id") } : {}),
    ...(form.has("project_id") ? { project_id: optional(form, "project_id") } : {}),
    ...(form.has("job_id") ? { job_id: optional(form, "job_id") } : {}),
    ...(form.has("vehicle_id") ? { vehicle_id: optional(form, "vehicle_id") } : {}),
  };
}

export async function reportIncident(form: FormData) {
  const path = "/hse/new";
  const values = incidentValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("hse_incidents").insert({ company_id: company.id, ...values }).select("id").single();
  if (error || !data) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hse");
  redirect(withNotice(`/hse/${data.id}`, { msg: "Reported. Management has been told." }));
}

export async function saveIncident(form: FormData) {
  const id = str(form, "id");
  const path = `/hse/${id}`;
  const values = incidentValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("hse_incidents")
    .update({ ...values, root_cause: optional(form, "root_cause"), reportable: str(form, "reportable") === "on" })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hse");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

const STATUS_DONE: Record<string, string> = {
  investigating: "Investigation started.",
  action: "Marked as actions in progress.",
  closed: "Closed.",
  open: "Opened again.",
};

/** Management moves an incident or NCR on. */
export async function setRecordStatus(form: FormData) {
  const kind = str(form, "kind") === "ncr" ? "ncr" : "incident";
  const id = str(form, "id");
  const status = str(form, "status");
  const path = sourcePath(kind, id);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("set_admin_status", { p_kind: kind, p_id: id, p_status: status });
  if (error) fail(path, error.message);
  revalidatePath(kind === "ncr" ? "/quality" : "/hse");
  revalidatePath(path);
  redirect(withNotice(path, { msg: STATUS_DONE[status] ?? "Saved." }));
}

// ---------------------------------------------------------------------------
// Inspections and toolbox talks
// ---------------------------------------------------------------------------

function inspectionValues(form: FormData, path: string) {
  const date = str(form, "inspected_on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(path, "Enter the date.");
  const count = toNumber(str(form, "attendee_count"));
  if (count !== null && (Number.isNaN(count) || count < 0 || count > 10000)) fail(path, "The number of attendees must be a whole number.");
  return {
    inspected_on: date,
    kind: pick(str(form, "kind"), INSPECTION_KINDS, "site"),
    site: optional(form, "site"),
    topic: optional(form, "topic"),
    result: pick(str(form, "result"), INSPECTION_RESULTS, "pass"),
    findings: optional(form, "findings"),
    attendees: optional(form, "attendees"),
    attendee_count: count === null ? null : Math.round(count),
    ...(form.has("project_id") ? { project_id: optional(form, "project_id") } : {}),
    ...(form.has("job_id") ? { job_id: optional(form, "job_id") } : {}),
    ...(form.has("vehicle_id") ? { vehicle_id: optional(form, "vehicle_id") } : {}),
  };
}

export async function recordInspection(form: FormData) {
  const path = "/hse/inspections/new";
  const values = inspectionValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("hse_inspections").insert({ company_id: company.id, ...values }).select("id").single();
  if (error || !data) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hse");
  redirect(withNotice(`/hse/inspections/${data.id}`, { msg: "Saved." }));
}

export async function saveInspection(form: FormData) {
  const id = str(form, "id");
  const path = `/hse/inspections/${id}`;
  const values = inspectionValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("hse_inspections").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hse");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

// ---------------------------------------------------------------------------
// Corrective actions (incidents, inspections and NCRs)
// ---------------------------------------------------------------------------

function actionSource(form: FormData) {
  const kind = str(form, "source_kind");
  const sourceKind = kind === "ncr" || kind === "inspection" ? kind : "incident";
  const sourceId = str(form, "source_id");
  return { sourceKind, sourceId, path: `${sourcePath(sourceKind, sourceId)}#actions` };
}

function done(path: string, msg: string): never {
  revalidatePath("/hse");
  revalidatePath("/quality");
  revalidatePath(path.split("#")[0]);
  redirect(noticeUrl(path, { msg }));
}

export async function addCorrectiveAction(form: FormData) {
  const { sourceKind, sourceId, path } = actionSource(form);
  const action = str(form, "action");
  if (action.length < 3 || action.length > 1000) fail(path, "Describe the action (3 to 1000 characters).");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("corrective_actions").insert({
    company_id: company.id,
    source_kind: sourceKind,
    source_id: sourceId,
    action,
    owner_id: optional(form, "owner_id"),
    due_on: optional(form, "due_on"),
  });
  if (error) fail(path, error.message);
  done(path, "Action added.");
}

export async function saveCorrectiveAction(form: FormData) {
  const { path } = actionSource(form);
  const action = str(form, "action");
  if (action.length < 3 || action.length > 1000) fail(path, "Describe the action (3 to 1000 characters).");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("corrective_actions")
    .update({ action, owner_id: optional(form, "owner_id"), due_on: optional(form, "due_on") })
    .eq("id", str(form, "action_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done(path, "Saved.");
}

export async function finishCorrectiveAction(form: FormData) {
  const { path } = actionSource(form);
  const isDone = str(form, "done") === "true";
  const note = optional(form, "note");
  if (isDone && !note) fail(path, "Say what was done.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("finish_corrective_action", { p_action: str(form, "action_id"), p_done: isDone, p_note: isDone ? note : null });
  if (error) fail(path, error.message);
  done(path, isDone ? "Action marked done." : "Action cancelled.");
}
