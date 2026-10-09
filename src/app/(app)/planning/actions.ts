"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reorderAction } from "../stock/reorder/actions";
import { getAppContext } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

/**
 * mode=levels: set the ticked products' reorder level to the planned reorder point and the maximum
 * to a month of sales above it. Otherwise the same as the reorder list (draft PO or purchase request).
 */
export async function planningAction(form: FormData) {
  if (str(form, "mode") !== "levels") return reorderAction(form);
  const days = str(form, "days") || "90";
  const back = `/planning?days=${days}`;
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editProducts")) redirect(withNotice(back, { error: "You don't have permission to edit products." }));
  const picked = form.getAll("pick").map(String);
  if (picked.length === 0) redirect(withNotice(back, { error: "Tick at least one item with a quantity." }));
  const { data, error } = await supabase.rpc("demand_plan", { p_company: company.id, p_days: Number(days) });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  for (const p of (data ?? []) as { product_id: string; per_day: number; reorder_point: number }[]) {
    if (!picked.includes(p.product_id) || Number(p.reorder_point) <= 0) continue;
    const reorder = Number(p.reorder_point);
    const max = Math.ceil(reorder + Number(p.per_day) * 30);
    const { error: e } = await supabase.from("products").update({ reorder_level: reorder, max_level: Math.max(max, reorder) }).eq("id", p.product_id).eq("company_id", company.id);
    if (e) redirect(withNotice(back, { error: friendlyError(e.message) }));
  }
  revalidatePath("/planning");
  revalidatePath("/stock");
  revalidatePath("/stock/reorder");
  redirect(withNotice(back, { msg: "Reorder and maximum levels set from sales." }));
}
