"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string) {
  revalidatePath("/contracts");
  if (id) revalidatePath(`/contracts/${id}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function contractValues(form: FormData, creating: boolean): { values?: Record<string, unknown>; error?: string } {
  const title = str(form, "title");
  if (title.length < 2) return { error: "Give the contract a name." };
  const start = str(form, "start_date");
  const end = str(form, "end_date");
  if (!start || !end) return { error: "Enter the start and end dates." };
  if (end < start) return { error: "The end date is before the start date." };
  const capRaw = str(form, "value_cap");
  const cap = capRaw ? toNumber(capRaw) : null;
  if (cap !== null && (Number.isNaN(cap) || cap < 0)) return { error: "Enter the contract value as a number." };
  const remind = Math.round(toNumber(str(form, "remind_days")) ?? 30);
  const values: Record<string, unknown> = {
    title,
    reference: optional(form, "reference"),
    kind: str(form, "kind") || "framework",
    start_date: start,
    end_date: end,
    value_cap: cap,
    payment_terms: optional(form, "payment_terms"),
    remind_days: Number.isNaN(remind) ? 30 : Math.min(Math.max(remind, 0), 180),
    notes: optional(form, "notes"),
    tender_id: optional(form, "tender_id"),
  };
  if (creating) {
    const client = str(form, "client_id");
    if (!client) return { error: "Choose the client." };
    values.client_id = client;
    values.currency = str(form, "currency") || "TZS";
  }
  return { values };
}

export async function createContract(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { values, error } = contractValues(form, true);
  if (error) fail("/contracts/new", error);
  const { data, error: dbError } = await supabase.from("contracts").insert({ company_id: company.id, ...values }).select("id").single();
  if (dbError) fail("/contracts/new", dbError.message);
  refresh(data.id);
  redirect(withNotice(`/contracts/${data.id}#prices`, { msg: "Contract added. Now enter the agreed price for each product." }));
}

export async function saveContract(form: FormData) {
  const id = str(form, "id");
  const path = `/contracts/${id}`;
  const { supabase, company } = await getAppContext();
  const { values, error } = contractValues(form, false);
  if (error) fail(path, error);
  const { data, error: dbError } = await supabase.from("contracts").update(values!).eq("id", id).eq("company_id", company.id).select("id");
  if (dbError || !data?.length) fail(path, dbError?.message ?? "0 rows");
  refresh(id);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function endContract(form: FormData) {
  const id = str(form, "id");
  const path = `/contracts/${id}`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("cancel_contract", { p_id: id, p_reason: str(form, "reason") });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(withNotice(path, { msg: "Contract ended. Its prices no longer apply to new quotations." }));
}

/** Add or change the contract price of a product. */
export async function setContractPrice(form: FormData) {
  const contract = str(form, "contract_id");
  const path = `/contracts/${contract}#prices`;
  const product = str(form, "product_id");
  const price = toNumber(str(form, "unit_price"));
  if (!product) fail(path, "Choose a product.");
  if (price === null || Number.isNaN(price) || price < 0) fail(path, "Enter the agreed price.");
  const { supabase, company } = await getAppContext();
  const { data: existing } = await supabase.from("contract_prices").select("id").eq("contract_id", contract).eq("product_id", product).maybeSingle();
  const { error } = existing
    ? await supabase.from("contract_prices").update({ unit_price: price, notes: optional(form, "notes") }).eq("id", existing.id)
    : await supabase
        .from("contract_prices")
        .insert({ company_id: company.id, contract_id: contract, product_id: product, unit_price: price, notes: optional(form, "notes") });
  if (error) fail(path, error.message);
  refresh(contract);
  redirect(withNotice(path, { msg: existing ? "Price changed." : "Price added." }));
}

export async function removeContractPrice(form: FormData) {
  const contract = str(form, "contract_id");
  const path = `/contracts/${contract}#prices`;
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("contract_prices").delete().eq("id", str(form, "id")).eq("company_id", company.id);
  if (error) fail(path, error.message);
  refresh(contract);
  redirect(withNotice(path, { msg: "Price removed." }));
}

/** On a draft quotation: use the client's contract prices. */
export async function applyContractPrices(form: FormData) {
  const quotation = str(form, "quotation_id");
  const path = `/quotations/${quotation}`;
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("apply_contract_prices", { p_quotation: quotation });
  if (error) fail(path, error.message);
  revalidatePath(path);
  const n = Number(data ?? 0);
  redirect(withNotice(path, { msg: n === 0 ? "The lines already use the contract prices." : `Contract prices used on ${n} line(s).` }));
}
