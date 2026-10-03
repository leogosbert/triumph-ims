"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/context";
import { friendlyError } from "@/lib/messages";

export type ImportResult =
  | {
      ok: true;
      counts: {
        suppliers_added: number;
        suppliers_updated: number;
        clients_added: number;
        clients_updated: number;
        products_added: number;
        products_updated: number;
      };
      unmatched: string[];
    }
  | { ok: false; error: string };

const MAX_ROWS = 5000;

export async function runImport(payload: {
  suppliers: Record<string, unknown>[];
  clients: Record<string, unknown>[];
  products: Record<string, unknown>[];
}): Promise<ImportResult> {
  const { supabase, company } = await requireManager();
  const lists = [payload?.suppliers, payload?.clients, payload?.products];
  if (lists.some((l) => !Array.isArray(l))) return { ok: false, error: "The import data was not readable." };
  if (lists.some((l) => l.length > MAX_ROWS))
    return { ok: false, error: `Please import at most ${MAX_ROWS} rows per list at a time.` };

  const { data, error } = await supabase.rpc("import_master_data", {
    p_company: company.id,
    p_suppliers: payload.suppliers,
    p_clients: payload.clients,
    p_products: payload.products,
  });
  if (error) return { ok: false, error: `Nothing was saved. ${friendlyError(error.message)}` };

  revalidatePath("/clients");
  revalidatePath("/suppliers");
  revalidatePath("/products");
  revalidatePath("/");
  const r = data as Record<string, unknown>;
  return {
    ok: true,
    counts: {
      suppliers_added: Number(r.suppliers_added ?? 0),
      suppliers_updated: Number(r.suppliers_updated ?? 0),
      clients_added: Number(r.clients_added ?? 0),
      clients_updated: Number(r.clients_updated ?? 0),
      products_added: Number(r.products_added ?? 0),
      products_updated: Number(r.products_updated ?? 0),
    },
    unmatched: Array.isArray(r.unmatched_suppliers) ? [...new Set(r.unmatched_suppliers as string[])] : [],
  };
}
