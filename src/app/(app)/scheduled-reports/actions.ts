"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { findReport } from "@/lib/reports/defs";
import { mayOpen } from "@/lib/reports/run";
import { FREQUENCIES, scheduleQuery } from "@/lib/schedules";

const fail = (path: string, error: string): never => redirect(withNotice(path, { error: friendlyError(error) }));

function timing(form: FormData, path: string) {
  const frequency = str(form, "frequency");
  if (!FREQUENCIES.some((f) => f.key === frequency)) fail(path, "Choose how often.");
  const day = Number(str(form, "weekday") || "1");
  return { frequency, weekday: frequency === "weekly" ? (day >= 1 && day <= 7 ? day : 1) : null };
}

export async function scheduleReport(form: FormData) {
  const key = str(form, "report_key");
  const def = findReport(key);
  const back = `/reports/${key}`;
  if (!def) redirect("/reports");
  const { supabase, company, role, features } = await getAppContext();
  if (!mayOpen(def, role, features)) redirect("/reports");
  const { error } = await supabase.from("report_schedules").insert({
    company_id: company.id,
    name: str(form, "name") || def.title,
    report_key: key,
    query: scheduleQuery(str(form, "query")),
    ...timing(form, back),
  });
  if (error) fail(back, /report_schedules_query_check|query/.test(error.message) ? "This report has settings that cannot be scheduled. Remove the search text and try again." : error.message);
  revalidatePath("/scheduled-reports");
  redirect(withNotice("/scheduled-reports", { msg: "Scheduled. You will get an alert and an email with the report link." }));
}

export async function updateSchedule(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const action = str(form, "action");
  const q = supabase.from("report_schedules");
  const { error } =
    action === "remove"
      ? await q.delete().eq("id", id).eq("company_id", company.id)
      : action === "pause" || action === "resume"
        ? await q.update({ active: action === "resume" }).eq("id", id).eq("company_id", company.id)
        : await q.update(timing(form, "/scheduled-reports")).eq("id", id).eq("company_id", company.id);
  if (error) fail("/scheduled-reports", error.message);
  revalidatePath("/scheduled-reports");
  redirect(withNotice("/scheduled-reports", { msg: action === "remove" ? "Removed." : "Saved." }));
}
