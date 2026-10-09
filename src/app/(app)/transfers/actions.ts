"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string) {
  revalidatePath("/transfers");
  revalidatePath("/stock");
  if (id) revalidatePath(`/transfers/${id}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

export async function createTransfer(form: FormData) {
  const from = str(form, "from_warehouse_id");
  const to = str(form, "to_warehouse_id");
  if (!from || !to) fail("/transfers/new", "Choose both stores.");
  if (from === to) fail("/transfers/new", "Choose two different stores.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("stock_transfers")
    .insert({ company_id: company.id, from_warehouse_id: from, to_warehouse_id: to, reason: optional(form, "reason"), vehicle: optional(form, "vehicle"), notes: optional(form, "notes") })
    .select("id")
    .single();
  if (error) fail("/transfers/new", error.message);
  refresh(data.id);
  redirect(withNotice(`/transfers/${data.id}#items`, { msg: "Transfer started. Add the items to move." }));
}

export async function addTransferLine(form: FormData) {
  const id = str(form, "transfer_id");
  const path = `/transfers/${id}#items`;
  const product = str(form, "product_id");
  const qty = toNumber(str(form, "quantity"));
  if (!product) fail(path, "Choose a product.");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(path, "Enter the quantity to move.");
  const { supabase, company } = await getAppContext();
  const { data: existing } = await supabase.from("stock_transfer_lines").select("id, quantity").eq("transfer_id", id).eq("product_id", product).maybeSingle();
  const { error } = existing
    ? await supabase.from("stock_transfer_lines").update({ quantity: Number(existing.quantity) + qty }).eq("id", existing.id)
    : await supabase.from("stock_transfer_lines").insert({ company_id: company.id, transfer_id: id, product_id: product, quantity: qty, note: optional(form, "note") });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(path);
}

export async function removeTransferLine(form: FormData) {
  const id = str(form, "transfer_id");
  const path = `/transfers/${id}#items`;
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("stock_transfer_lines").delete().eq("id", str(form, "line_id")).eq("company_id", company.id);
  if (error) fail(path, error.message);
  refresh(id);
  redirect(path);
}

export async function transferAction(form: FormData) {
  const id = str(form, "id");
  const path = `/transfers/${id}`;
  const action = str(form, "action");
  const { supabase } = await getAppContext();
  const { error } =
    action === "send"
      ? await supabase.rpc("send_stock_transfer", { p_id: id })
      : action === "receive"
        ? await supabase.rpc("receive_stock_transfer", { p_id: id, p_note: optional(form, "note") })
        : await supabase.rpc("cancel_stock_transfer", { p_id: id });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(
    withNotice(path, {
      msg: action === "send" ? "Sent. The stock left the store and is on the way." : action === "receive" ? "Received. The stock is now in the store." : "Transfer cancelled.",
    }),
  );
}
