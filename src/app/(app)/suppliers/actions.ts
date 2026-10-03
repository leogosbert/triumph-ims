"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { parseSections, SUPPLIER_SECTIONS } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { saveRecord } from "@/lib/records";
import { can } from "@/lib/roles";

export async function saveSupplier(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  const id = str(form, "id");
  const back = id ? `/suppliers/${id}` : "/suppliers/new";
  if (!can(role, "editSuppliers")) redirect(withNotice(back, { error: "You don't have permission to edit suppliers." }));

  const { values, error } = parseSections(form, SUPPLIER_SECTIONS);
  if (error) redirect(withNotice(back, { error }));

  const res = await saveRecord(supabase, "suppliers", company.id, id, values);
  if (res.error) redirect(withNotice(back, { error: friendlyError(res.error) }));
  revalidatePath("/suppliers");
  redirect(withNotice(`/suppliers/${res.id}`, { msg: id ? "Supplier saved." : "Supplier added." }));
}

export async function setSupplierActive(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  const { data, error } = await supabase
    .from("suppliers")
    .update({ active })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length)
    redirect(withNotice(`/suppliers/${id}`, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath("/suppliers");
  redirect(withNotice(`/suppliers/${id}`, { msg: active ? "Supplier restored." : "Supplier archived." }));
}
