"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { hseError, NCR_DISPOSITIONS, NCR_SOURCES } from "@/lib/hse";
import { friendlyError, withNotice } from "@/lib/messages";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(hseError(error)) }));
}

const LINKS = ["supplier_id", "client_id", "product_id", "purchase_order_id", "delivery_id"] as const;

function ncrValues(form: FormData, path: string) {
  const title = str(form, "title");
  if (title.length < 3 || title.length > 160) fail(path, "The title must be 3 to 160 characters.");
  const description = str(form, "description");
  if (description.length < 3) fail(path, "Say what is wrong (at least 3 characters).");
  const qty = toNumber(str(form, "quantity_affected"));
  if (qty !== null && (Number.isNaN(qty) || qty < 0)) fail(path, "The quantity must be a number of zero or more.");
  const cost = toNumber(str(form, "cost"));
  if (cost !== null && (Number.isNaN(cost) || cost < 0)) fail(path, "The cost must be a number of zero or more.");
  const source = str(form, "source");
  const disposition = str(form, "disposition");
  const values: Record<string, unknown> = {
    source: source in NCR_SOURCES ? source : "supplier",
    title,
    description,
    quantity_affected: qty,
    disposition: disposition in NCR_DISPOSITIONS ? disposition : null,
    cost: cost ?? 0,
  };
  const raised = str(form, "raised_on");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raised)) values.raised_on = raised;
  // Only sent when the form showed the select.
  for (const k of LINKS) if (form.has(k)) values[k] = optional(form, k);
  return values;
}

export async function createNcr(form: FormData) {
  const path = "/quality/new";
  const values = ncrValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("quality_ncrs").insert({ company_id: company.id, ...values }).select("id").single();
  if (error || !data) fail(path, error?.message ?? "0 rows");
  revalidatePath("/quality");
  redirect(withNotice(`/quality/${data.id}`, { msg: "NCR raised. Management has been told." }));
}

export async function saveNcr(form: FormData) {
  const id = str(form, "id");
  const path = `/quality/${id}`;
  const values = ncrValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("quality_ncrs")
    .update({ ...values, root_cause: optional(form, "root_cause") })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/quality");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}
