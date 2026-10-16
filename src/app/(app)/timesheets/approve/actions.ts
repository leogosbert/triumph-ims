"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function backTo(form: FormData) {
  const b = str(form, "back");
  return b.startsWith("/timesheets/approve") ? b : "/timesheets/approve";
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

export async function decideWeek(form: FormData) {
  const path = backTo(form);
  const approve = str(form, "decision") === "approve";
  const note = optional(form, "note");
  if (!approve && !note) fail(path, "Say what needs to change.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("decide_timesheet_week", { p_week: str(form, "week_id"), p_approve: approve, p_note: approve ? null : note });
  if (error) fail(path, error.message);
  revalidatePath("/timesheets/approve");
  revalidatePath("/timesheets");
  redirect(withNotice(path, { msg: approve ? "Week approved." : "Week sent back." }));
}

export async function reopenWeek(form: FormData) {
  const path = backTo(form);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("reopen_timesheet_week", { p_week: str(form, "week_id") });
  if (error) fail(path, error.message);
  revalidatePath("/timesheets/approve");
  revalidatePath("/timesheets");
  redirect(withNotice(path, { msg: "The week is open again. The person can change it and submit it again." }));
}
