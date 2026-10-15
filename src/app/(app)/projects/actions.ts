"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { canInvoiceService, PROJECT_BILLING, PROJECT_STATUS } from "@/lib/services";
import { canKeepProjects } from "./projectData";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function amount(form: FormData, key: string, path: string): number | null {
  const v = toNumber(str(form, key));
  if (v === null) return null;
  if (Number.isNaN(v) || v < 0) fail(path, "Amounts, hours and rates must be numbers of zero or more.");
  return v;
}

function projectValues(form: FormData, path: string) {
  const billing = str(form, "billing");
  const name = str(form, "name");
  if (name.length < 2) fail(path, "Enter the project name.");
  const starts = optional(form, "starts_on");
  const ends = optional(form, "ends_on");
  if (starts && ends && ends < starts) fail(path, "The end date must be after the start date.");
  return {
    name,
    description: optional(form, "description"),
    billing: billing in PROJECT_BILLING ? billing : "time",
    budget_amount: amount(form, "budget_amount", path),
    budget_hours: amount(form, "budget_hours", path),
    default_rate: amount(form, "default_rate", path),
    currency: (str(form, "currency") || "TZS").toUpperCase(),
    starts_on: starts,
    ends_on: ends,
    manager_id: optional(form, "manager_id"),
  };
}

export async function createProject(form: FormData) {
  const path = "/projects/new";
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role)) fail(path, "You don't have permission to do that.");
  const values = projectValues(form, path);
  const clientId = str(form, "client_id");
  if (!clientId) fail(path, "Choose the client.");
  const { data, error } = await supabase
    .from("projects")
    .insert({ company_id: company.id, client_id: clientId, ...values })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath("/projects");
  redirect(withNotice(`/projects/${data.id}`, { msg: "Project added." }));
}

export async function saveProject(form: FormData) {
  const id = str(form, "id");
  const path = `/projects/${id}`;
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role)) fail(path, "You don't have permission to do that.");
  const values = projectValues(form, path);
  const status = str(form, "status");
  const { data, error } = await supabase
    .from("projects")
    .update({ ...values, ...(status in PROJECT_STATUS ? { status } : {}) })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/projects");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setProjectStatus(form: FormData) {
  const id = str(form, "id");
  const path = `/projects/${id}`;
  const status = str(form, "status");
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role) || !(status in PROJECT_STATUS)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase.from("projects").update({ status }).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/projects");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Project status changed." }));
}

export async function addMilestone(form: FormData) {
  const id = str(form, "project_id");
  const path = `/projects/${id}#milestones`;
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role)) fail(path, "You don't have permission to do that.");
  const title = str(form, "title");
  if (title.length < 2) fail(path, "Enter what the milestone is.");
  const { count } = await supabase.from("project_milestones").select("id", { count: "exact", head: true }).eq("project_id", id);
  const { error } = await supabase.from("project_milestones").insert({
    company_id: company.id,
    project_id: id,
    title,
    due_on: optional(form, "due_on"),
    amount: amount(form, "amount", path),
    sort: (count ?? 0) + 1,
  });
  if (error) fail(path, error.message);
  revalidatePath(`/projects/${id}`);
  redirect(withNotice(path, { msg: "Milestone added." }));
}

export async function markMilestone(form: FormData) {
  const id = str(form, "project_id");
  const path = `/projects/${id}#milestones`;
  const status = str(form, "status") === "open" ? "open" : "done";
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase
    .from("project_milestones")
    .update({ status })
    .eq("id", str(form, "milestone_id"))
    .eq("company_id", company.id)
    .neq("status", "invoiced")
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/projects/${id}`);
  redirect(withNotice(path, { msg: status === "done" ? "Milestone marked done." : "Milestone opened again." }));
}

export async function removeMilestone(form: FormData) {
  const id = str(form, "project_id");
  const path = `/projects/${id}#milestones`;
  const { supabase, company, role } = await getAppContext();
  if (!canKeepProjects(role)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase
    .from("project_milestones")
    .delete()
    .eq("id", str(form, "milestone_id"))
    .eq("company_id", company.id)
    .eq("status", "open")
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/projects/${id}`);
  redirect(withNotice(path, { msg: "Removed." }));
}

export async function invoiceProject(form: FormData) {
  const id = str(form, "project_id");
  const path = `/projects/${id}#invoice`;
  const { supabase, role } = await getAppContext();
  if (!canInvoiceService(role)) fail(path, "Only management and finance can invoice projects.");
  const milestones = form.getAll("milestones").filter((v): v is string => typeof v === "string" && v !== "");
  const until = optional(form, "hours_until");
  if (!milestones.length && !until) fail(path, "Tick a milestone or choose the date to invoice hours up to.");
  const { data, error } = await supabase.rpc("invoice_project", {
    p_project: id,
    p_milestones: milestones,
    p_hours_until: until,
  });
  if (error || !data) fail(path, error?.message ?? "Something went wrong. Please try again.");
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/invoices");
  redirect(withNotice(`/invoices/${data as string}`, { msg: "Draft invoice made." }));
}
