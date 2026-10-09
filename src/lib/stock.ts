import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const DELIVERY_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Being prepared", tone: "off" },
  dispatched: { label: "On the way", tone: "warn" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export type Store = { id: string; code: string; name: string; active: boolean };

export async function storeOptions(supabase: Supabase, companyId: string, activeOnly = true) {
  let q = supabase.from("warehouses").select("id, code, name, active").eq("company_id", companyId).order("code");
  if (activeOnly) q = q.eq("active", true);
  const { data } = await q;
  const stores = (data ?? []) as Store[];
  // Main store first.
  stores.sort((a, b) => (a.code === "MAIN" ? -1 : b.code === "MAIN" ? 1 : a.code.localeCompare(b.code)));
  return stores;
}

export type OnHand = { product_id: string; warehouse_id: string; batch_no: string; expiry_date: string | null; quantity: number };

export function fmtQty(v: unknown) {
  return Number(v ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

/** Days from today (Dar es Salaam) to a date; negative when past. */
export function daysUntil(iso: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  return Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
}

export const TRANSFER_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Being prepared", tone: "off" },
  in_transit: { label: "On the way", tone: "warn" },
  received: { label: "Received", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const REQUEST_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  submitted: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved, to order", tone: "info" },
  rejected: { label: "Rejected", tone: "bad" },
  ordered: { label: "Ordered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};
