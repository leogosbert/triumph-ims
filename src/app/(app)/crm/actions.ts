"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string, clientId?: string | null) {
  revalidatePath("/crm");
  if (id) revalidatePath(`/crm/${id}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

/** The editable fields of an opportunity. */
function oppValues(form: FormData): { values?: Record<string, unknown>; error?: string } {
  const title = str(form, "title");
  if (title.length < 2) return { error: "Say what the client needs." };
  const client = str(form, "client_id");
  const prospect = optional(form, "prospect_name");
  if (!client && !prospect) return { error: "Choose a client or type the name of the new prospect." };
  const value = toNumber(str(form, "value")) ?? 0;
  if (Number.isNaN(value) || value < 0) return { error: "Enter the expected value as a number." };
  const values: Record<string, unknown> = {
    title,
    client_id: client || null,
    prospect_name: client ? null : prospect,
    contact_name: optional(form, "contact_name"),
    contact_phone: optional(form, "contact_phone"),
    contact_email: optional(form, "contact_email"),
    source: str(form, "source") || "other",
    value,
    currency: str(form, "currency") || "TZS",
    expected_close: optional(form, "expected_close"),
    owner_id: optional(form, "owner_id"),
    next_action: optional(form, "next_action"),
    next_on: optional(form, "next_on"),
    notes: optional(form, "notes"),
  };
  return { values };
}

export async function createOpportunity(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { values, error } = oppValues(form);
  if (error) fail("/crm/new", error);
  const stage = str(form, "stage");
  const { data, error: dbError } = await supabase
    .from("opportunities")
    .insert({ company_id: company.id, ...values, stage: stage === "qualified" ? "qualified" : "lead" })
    .select("id, client_id")
    .single();
  if (dbError) fail("/crm/new", dbError.message);
  refresh(data.id, data.client_id);
  redirect(withNotice(`/crm/${data.id}`, { msg: "Opportunity added." }));
}

export async function saveOpportunity(form: FormData) {
  const id = str(form, "id");
  const path = `/crm/${id}`;
  const { supabase, company } = await getAppContext();
  const { values, error } = oppValues(form);
  if (error) fail(path, error);
  const { data, error: dbError } = await supabase
    .from("opportunities")
    .update(values!)
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id, client_id");
  if (dbError || !data?.length) fail(path, dbError?.message ?? "0 rows");
  refresh(id, data[0].client_id);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function moveOpportunity(form: FormData) {
  const id = str(form, "id");
  const path = `/crm/${id}`;
  const { supabase } = await getAppContext();
  const stage = str(form, "stage");
  const { error } = await supabase.rpc("set_opportunity_stage", { p_id: id, p_stage: stage, p_reason: optional(form, "reason") });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(withNotice(path, { msg: stage === "won" ? "Marked as won. Well done!" : stage === "lost" ? "Marked as lost." : "Stage changed." }));
}

export async function convertProspect(form: FormData) {
  const id = str(form, "id");
  const path = `/crm/${id}`;
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("convert_opportunity_client", { p_id: id });
  if (error) fail(path, error.message);
  refresh(id, data as string);
  redirect(withNotice(path, { msg: "The prospect is now a client. Complete their details on the client page." }));
}

export async function linkQuotation(form: FormData) {
  const id = str(form, "id");
  const path = `/crm/${id}`;
  const quotation = str(form, "quotation_id");
  if (!quotation) fail(path, "Choose a quotation.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("link_opportunity_quotation", { p_id: id, p_quotation: quotation });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(withNotice(path, { msg: "Quotation linked. The opportunity is won or lost when the client answers it." }));
}

/** Start a quotation for the opportunity's client and link it. */
export async function quoteOpportunity(form: FormData) {
  const id = str(form, "id");
  const path = `/crm/${id}`;
  const { supabase, company } = await getAppContext();
  const { data: o } = await supabase.from("opportunities").select("client_id").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!o?.client_id) fail(path, "Make the prospect a client first.");
  const { data: q, error } = await supabase.rpc("create_quotation", { p_company: company.id, p_client: o.client_id, p_rfq: null });
  if (error) fail(path, error.message);
  const { error: linkError } = await supabase.rpc("link_opportunity_quotation", { p_id: id, p_quotation: q as string });
  if (linkError) fail(path, linkError.message);
  refresh(id);
  revalidatePath("/quotations");
  redirect(withNotice(`/quotations/${q}`, { msg: "Quotation started for this opportunity. Add the items." }));
}

/** Log a call, visit or message (on an opportunity or straight on a client). */
export async function logActivity(form: FormData) {
  const back = str(form, "back") || "/crm";
  const opportunity = optional(form, "opportunity_id");
  const client = optional(form, "client_id");
  const summary = str(form, "summary");
  if (summary.length < 2) fail(back, "Write what was said or agreed.");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("crm_activities").insert({
    company_id: company.id,
    opportunity_id: opportunity,
    client_id: opportunity ? null : client,
    kind: str(form, "kind") || "call",
    happened_on: optional(form, "happened_on") ?? undefined,
    summary,
    location: optional(form, "location"),
    next_action: optional(form, "next_action"),
    next_on: optional(form, "next_on"),
  });
  if (error) fail(back, error.message);
  refresh(opportunity ?? undefined, client);
  redirect(withNotice(back, { msg: "Saved in the history." }));
}

export async function addImportantDate(form: FormData) {
  const client = str(form, "client_id");
  const back = `/clients/${client}#dates`;
  const title = str(form, "title");
  if (title.length < 2) fail(back, "Say what the date is.");
  if (!str(form, "the_date")) fail(back, "Choose the date.");
  const remind = Math.round(toNumber(str(form, "remind_days")) ?? 3);
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("important_dates").insert({
    company_id: company.id,
    client_id: client,
    title,
    kind: str(form, "kind") || "other",
    the_date: str(form, "the_date"),
    yearly: form.get("yearly") === "on",
    remind_days: Number.isNaN(remind) ? 3 : Math.min(Math.max(remind, 0), 90),
    notes: optional(form, "notes"),
  });
  if (error) fail(back, error.message);
  revalidatePath(`/clients/${client}`);
  redirect(withNotice(back, { msg: "Date saved. You will be reminded before it." }));
}

export async function deleteImportantDate(form: FormData) {
  const client = str(form, "client_id");
  const back = `/clients/${client}#dates`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("important_dates").delete().eq("id", str(form, "id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(back, error?.message ?? "0 rows");
  revalidatePath(`/clients/${client}`);
  redirect(withNotice(back, { msg: "Date removed." }));
}
