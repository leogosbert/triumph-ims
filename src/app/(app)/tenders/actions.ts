"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string) {
  revalidatePath("/tenders");
  if (id) revalidatePath(`/tenders/${id}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

/** "2026-11-04" + "10:00" in Dar es Salaam time → ISO timestamp. */
function darTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^\d{2}:\d{2}$/.test(time) ? time : "10:00";
  return `${date}T${t}:00+03:00`;
}

function money(form: FormData, key: string): number | null | "bad" {
  const raw = str(form, key);
  if (!raw) return null;
  const n = toNumber(raw);
  return n === null || Number.isNaN(n) || n < 0 ? "bad" : n;
}

function tenderValues(form: FormData): { values?: Record<string, unknown>; error?: string } {
  const title = str(form, "title");
  if (title.length < 2) return { error: "Enter what the tender is for." };
  const client = str(form, "client_id");
  const buyer = optional(form, "buyer_name");
  if (!client && !buyer) return { error: "Choose the client or type the buyer's name." };
  const closing = darTime(str(form, "closing_date"), str(form, "closing_time"));
  if (!closing) return { error: "Enter the closing date." };
  const nums: Record<string, number | null> = {};
  for (const k of ["bid_security", "estimated_value", "our_price"]) {
    const v = money(form, k);
    if (v === "bad") return { error: "Amounts must be numbers." };
    nums[k] = v;
  }
  const visit = str(form, "site_visit_date");
  return {
    values: {
      title,
      client_id: client || null,
      buyer_name: client ? null : buyer,
      reference: optional(form, "reference"),
      category: optional(form, "category"),
      published_on: optional(form, "published_on"),
      site_visit_at: visit ? darTime(visit, str(form, "site_visit_time")) : null,
      clarification_by: optional(form, "clarification_by"),
      closing_at: closing,
      submission: optional(form, "submission"),
      currency: str(form, "currency") || "TZS",
      owner_id: optional(form, "owner_id"),
      opportunity_id: optional(form, "opportunity_id"),
      notes: optional(form, "notes"),
      ...nums,
    },
  };
}

export async function createTender(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { values, error } = tenderValues(form);
  if (error) fail("/tenders/new", error);
  const { data, error: dbError } = await supabase.from("tenders").insert({ company_id: company.id, ...values }).select("id").single();
  if (dbError) fail("/tenders/new", dbError.message);
  refresh(data.id);
  redirect(withNotice(`/tenders/${data.id}`, { msg: "Tender added with the usual checklist. Untick or add steps as needed." }));
}

export async function saveTender(form: FormData) {
  const id = str(form, "id");
  const path = `/tenders/${id}`;
  const { supabase, company } = await getAppContext();
  const { values, error } = tenderValues(form);
  if (error) fail(path, error);
  const { data, error: dbError } = await supabase.from("tenders").update(values!).eq("id", id).eq("company_id", company.id).select("id");
  if (dbError || !data?.length) fail(path, dbError?.message ?? "0 rows");
  refresh(id);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setTenderStatus(form: FormData) {
  const id = str(form, "id");
  const path = `/tenders/${id}`;
  const status = str(form, "status");
  const { supabase, company } = await getAppContext();
  const price = money(form, "our_price");
  if (price === "bad") fail(path, "Amounts must be numbers.");
  if (price !== null) {
    const { error } = await supabase.from("tenders").update({ our_price: price }).eq("id", id).eq("company_id", company.id);
    if (error) fail(path, error.message);
  }
  const winning = money(form, "winning_price");
  if (winning === "bad") fail(path, "Amounts must be numbers.");
  const { error } = await supabase.rpc("set_tender_status", {
    p_id: id,
    p_status: status,
    p_note: optional(form, "note"),
    p_winning_price: winning,
    p_winner: optional(form, "winner"),
  });
  if (error) fail(path, error.message);
  refresh(id);
  revalidatePath("/crm");
  redirect(withNotice(path, { msg: status === "won" ? "Tender won. Add the contract and its prices next." : "Tender updated." }));
}

export async function toggleTask(form: FormData) {
  const tender = str(form, "tender_id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("set_tender_task_done", { p_task: str(form, "task_id"), p_done: str(form, "done") === "1" });
  if (error) fail(`/tenders/${tender}`, error.message);
  refresh(tender);
  redirect(`/tenders/${tender}#checklist`);
}

export async function addTask(form: FormData) {
  const tender = str(form, "tender_id");
  const path = `/tenders/${tender}#checklist`;
  const title = str(form, "title");
  if (title.length < 2) fail(path, "Write the step.");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase
    .from("tender_tasks")
    .insert({ company_id: company.id, tender_id: tender, title, due_on: optional(form, "due_on"), sort: 1000 });
  if (error) fail(path, error.message);
  refresh(tender);
  redirect(path);
}

export async function removeTask(form: FormData) {
  const tender = str(form, "tender_id");
  const path = `/tenders/${tender}#checklist`;
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("tender_tasks").delete().eq("id", str(form, "task_id")).eq("company_id", company.id);
  if (error) fail(path, error.message);
  refresh(tender);
  redirect(path);
}
