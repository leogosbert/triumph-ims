"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

/** Log a call, message or visit on a quotation or invoice, with the next follow-up (or promised payment) date. */
export async function logFollowup(form: FormData) {
  const { supabase } = await getAppContext();
  const kind = str(form, "kind") === "invoice" ? "invoice" : "quotation";
  const id = str(form, "id");
  const path = kind === "invoice" ? `/invoices/${id}` : `/quotations/${id}`;
  const anchor = kind === "invoice" ? "#remind" : "#follow-up";
  const { error } = await supabase.rpc("log_followup", {
    p_quotation: kind === "quotation" ? id : null,
    p_invoice: kind === "invoice" ? id : null,
    p_channel: str(form, "channel") || "call",
    p_note: optional(form, "note"),
    p_next_on: optional(form, "next_on"),
  });
  if (error) redirect(withNotice(`${path}${anchor}`, { error: friendlyError(error.message) }));
  revalidatePath(path);
  revalidatePath("/notifications");
  redirect(withNotice(`${path}${anchor}`, { msg: kind === "invoice" ? "Reminder logged." : "Follow-up logged." }));
}
