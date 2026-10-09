"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { parseSections, PRODUCT_SECTIONS, toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { saveRecord } from "@/lib/records";
import { can } from "@/lib/roles";

export async function saveProduct(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  const id = str(form, "id");
  const back = id ? `/products/${id}` : "/products/new";
  if (!can(role, "editProducts")) redirect(withNotice(back, { error: "You don't have permission to edit products." }));

  const { values, error } = parseSections(form, PRODUCT_SECTIONS);
  if (error) redirect(withNotice(back, { error }));

  let res = await saveRecord(supabase, "products", company.id, id, values);
  // Before the Stage 14 database update there is no maximum level yet: save the rest.
  if (res.error && /max_level/.test(res.error) && !/check constraint/.test(res.error)) {
    delete values.max_level;
    res = await saveRecord(supabase, "products", company.id, id, values);
  }
  if (res.error) redirect(withNotice(back, { error: friendlyError(res.error) }));
  revalidatePath("/products");
  redirect(withNotice(`/products/${res.id}`, { msg: id ? "Product saved." : "Product added." }));
}

export async function saveProductCost(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  const productId = str(form, "product_id");
  const back = `/products/${productId}#costs`;
  if (!can(role, "editCosts")) redirect(withNotice(back, { error: "You don't have permission to change costs." }));

  const cost = toNumber(str(form, "last_cost"));
  if (Number.isNaN(cost) || (cost !== null && cost < 0))
    redirect(withNotice(back, { error: "Last cost must be a number of zero or more." }));

  const { error } = await supabase.from("product_costs").upsert(
    {
      product_id: productId,
      company_id: company.id,
      main_supplier_id: str(form, "main_supplier_id") || null,
      last_cost: cost,
    },
    { onConflict: "product_id" },
  );
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(`/products/${productId}`);
  redirect(withNotice(back, { msg: "Purchasing details saved." }));
}

export async function setProductActive(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  const { data, error } = await supabase
    .from("products")
    .update({ active })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length)
    redirect(withNotice(`/products/${id}`, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath("/products");
  redirect(withNotice(`/products/${id}`, { msg: active ? "Product restored." : "Product archived." }));
}
