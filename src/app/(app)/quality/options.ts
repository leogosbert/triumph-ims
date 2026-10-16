import type { createClient } from "@/lib/supabase/server";
import type { Ncr } from "@/lib/hse";
import type { NcrOptions } from "./NcrFields";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
const s = (v: unknown) => (typeof v === "string" ? v : "");
const nameOf = (v: unknown) => s((v as { name?: string } | null)?.name);

/** Suppliers, clients, products, purchase orders and deliveries an NCR can point at (recent 200 each, what this person may read). */
export async function loadNcrOptions(supabase: Supabase, companyId: string): Promise<NcrOptions> {
  const [sup, cli, prod, po, del] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("company_id", companyId).eq("active", true).order("name").limit(200),
    supabase.from("clients").select("id, name").eq("company_id", companyId).eq("active", true).order("name").limit(200),
    supabase.from("products").select("id, name, sku").eq("company_id", companyId).eq("active", true).order("name").limit(200),
    supabase.from("purchase_orders").select("id, number, supplier:suppliers(name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
    supabase.from("deliveries").select("id, number, client:clients(name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
  ]);
  return {
    suppliers: rows(sup).map((r) => ({ id: s(r.id), label: s(r.name) })),
    clients: rows(cli).map((r) => ({ id: s(r.id), label: s(r.name) })),
    products: rows(prod).map((r) => ({ id: s(r.id), label: [s(r.name), s(r.sku)].filter(Boolean).join(" · ") })),
    orders: rows(po).map((r) => ({ id: s(r.id), label: [s(r.number), nameOf(r.supplier)].filter(Boolean).join(" · ") })),
    deliveries: rows(del).map((r) => ({ id: s(r.id), label: [s(r.number), nameOf(r.client)].filter(Boolean).join(" · ") })),
  };
}

/** Names of the records an NCR points at. */
export async function ncrLinkedNames(supabase: Supabase, n: Pick<Ncr, "supplier_id" | "client_id" | "product_id" | "purchase_order_id" | "delivery_id">) {
  const one = async (table: string, cols: string, id: string | null, label: (r: Row) => string) => {
    if (!id) return null;
    const { data } = await supabase.from(table).select(cols).eq("id", id).maybeSingle();
    return data ? label(data as unknown as Row) : null;
  };
  const [supplier, client, product, order, delivery] = await Promise.all([
    one("suppliers", "name", n.supplier_id, (r) => s(r.name)),
    one("clients", "name", n.client_id, (r) => s(r.name)),
    one("products", "name, sku", n.product_id, (r) => [s(r.name), s(r.sku)].filter(Boolean).join(" · ")),
    one("purchase_orders", "number", n.purchase_order_id, (r) => s(r.number)),
    one("deliveries", "number", n.delivery_id, (r) => s(r.number)),
  ]);
  return { supplier, client, product, order, delivery };
}
