import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ClientOption = { id: string; name: string; code: string; currency: string };
export type ProductOption = { id: string; name: string; sku: string; unit: string; selling_price: number | null };

export async function clientOptions(supabase: Supabase, companyId: string) {
  const { data } = await supabase
    .from("clients")
    .select("id, name, code, currency")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name")
    .limit(2000);
  return (data ?? []) as ClientOption[];
}

export async function productOptions(supabase: Supabase, companyId: string) {
  const { data } = await supabase
    .from("products")
    .select("id, name, sku, unit, selling_price")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name")
    .limit(3000);
  return (data ?? []) as ProductOption[];
}
