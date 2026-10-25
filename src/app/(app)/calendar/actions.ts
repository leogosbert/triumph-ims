"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { siteUrl } from "@/lib/supabase/env";

function back(form: FormData): string {
  const b = str(form, "back");
  return b.startsWith("/calendar") && !b.startsWith("//") ? b : "/calendar";
}

export async function addEntry(form: FormData) {
  const path = back(form);
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("calendar_add_entry", {
    p_company: company.id,
    p: {
      title: str(form, "title"),
      kind: str(form, "kind") || "other",
      starts_on: str(form, "starts_on"),
      ends_on: optional(form, "ends_on"),
      at_time: optional(form, "at_time"),
      notes: optional(form, "notes"),
      owner_id: optional(form, "owner_id"),
      private: str(form, "private") === "1",
    },
  });
  if (error) redirect(withNotice(path, { error: friendlyError(error.message) }));
  revalidatePath("/calendar");
  redirect(withNotice(path, { msg: "Added to the calendar." }));
}

export async function removeEntry(form: FormData) {
  const path = back(form);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("calendar_remove_entry", { p_entry: str(form, "id") });
  if (error) redirect(withNotice(path, { error: friendlyError(error.message) }));
  revalidatePath("/calendar");
  redirect(withNotice(path, { msg: "Removed." }));
}

export type FeedState = { url?: string; webcal?: string; google?: string; outlook?: string; off?: boolean; error?: string };

/** My private calendar link (shown only here; a new one stops the old one). */
export async function feedLink(_prev: FeedState, form: FormData): Promise<FeedState> {
  const how = str(form, "how");
  const { supabase, company } = await getAppContext();
  if (how === "off") {
    const { error } = await supabase.rpc("calendar_link_off", { p_company: company.id });
    return error ? { error: friendlyError(error.message) } : { off: true };
  }
  const kinds = form.getAll("kinds").filter((k): k is string => typeof k === "string");
  const { data, error } = await supabase.rpc("calendar_link", { p_company: company.id, p_new: how === "new", p_kinds: kinds.length ? kinds : null });
  if (error || typeof data !== "string") return { error: friendlyError(error?.message) };
  const url = `${siteUrl()}/api/calendar/${data}.ics`;
  const webcal = url.replace(/^https?:/, "webcal:");
  return {
    url,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(company.name)}`,
  };
}
