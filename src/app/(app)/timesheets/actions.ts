"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { canInvoiceService } from "@/lib/services";
import { mondayOf } from "./week";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

export async function addHours(form: FormData) {
  const workDate = str(form, "work_date");
  const path = `/timesheets?week=${mondayOf(workDate)}#add`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) fail(path, "Choose the day.");
  const hours = toNumber(str(form, "hours"));
  if (hours === null || Number.isNaN(hours) || hours <= 0 || hours > 24) fail(path, "Hours must be a number above 0 and up to 24.");
  const target = str(form, "target");
  const jobId = target.startsWith("job:") ? target.slice(4) : null;
  const projectId = target.startsWith("project:") ? target.slice(8) : null;
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("timesheets").insert({
    company_id: company.id,
    work_date: workDate,
    hours: Math.round(hours * 100) / 100,
    job_id: jobId,
    project_id: projectId,
    // The job or project brings its own client.
    client_id: jobId || projectId ? null : optional(form, "client_id"),
    description: optional(form, "description"),
    billable: str(form, "billable") === "on",
  });
  if (error) fail(path, error.message);
  revalidatePath("/timesheets");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  redirect(withNotice(path.replace("#add", ""), { msg: "Hours saved." }));
}

export async function removeHours(form: FormData) {
  const path = `/timesheets?week=${mondayOf(str(form, "week"))}`;
  const { supabase, company, user } = await getAppContext();
  const { data, error } = await supabase
    .from("timesheets")
    .delete()
    .eq("id", str(form, "id"))
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .is("invoice_id", null)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/timesheets");
  redirect(withNotice(path, { msg: "Removed." }));
}

function rate(form: FormData, key: string): number | null | "bad" {
  const v = toNumber(str(form, key));
  if (v === null) return null;
  return Number.isNaN(v) || v < 0 ? "bad" : v;
}

export async function saveTeamRate(form: FormData) {
  const path = "/timesheets/rates";
  const userId = str(form, "user_id");
  const { supabase, company, role } = await getAppContext();
  if (!canInvoiceService(role)) fail(path, "Only management or finance can change rates.");
  const bill = rate(form, "bill_rate");
  const cost = rate(form, "cost_rate");
  if (bill === "bad" || cost === "bad") fail(path, "Rates must be numbers of zero or more.");
  const title = optional(form, "title");
  if (title && title.length > 80) fail(path, "The title is too long.");
  const values = { bill_rate: bill, cost_rate: cost, title };
  // Insert or update by hand: an upsert would also update company_id and user_id, which are not granted for update.
  const { data: existing, error: readError } = await supabase
    .from("team_rates")
    .select("user_id")
    .eq("company_id", company.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) fail(path, readError.message);
  const { error } = existing
    ? await supabase.from("team_rates").update(values).eq("company_id", company.id).eq("user_id", userId)
    : await supabase.from("team_rates").insert({ company_id: company.id, user_id: userId, ...values });
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Rates saved. New hours use them; hours already recorded keep their rate." }));
}
