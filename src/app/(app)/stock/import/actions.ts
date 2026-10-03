"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/context";
import { friendlyError } from "@/lib/messages";
import { can } from "@/lib/roles";

export type StockRow = { sku: string; store: string; quantity: number | string; batch_no: string; expiry_date: string };

export async function importOpeningStock(rows: StockRow[]): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "adjustStock")) return { ok: false, error: "Only management and warehouse can load stock." };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "The file has no rows." };
  const { data, error } = await supabase.rpc("import_opening_stock", { p_company: company.id, p_rows: rows });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/stock");
  revalidatePath("/");
  return { ok: true, count: Number(data ?? 0) };
}
