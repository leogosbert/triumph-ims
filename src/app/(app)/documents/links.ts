import type { createClient } from "@/lib/supabase/server";
import type { LinkOptions } from "./DocumentFields";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Named = { id: string; name: string };

/** What a document can be linked to (each list is what the person may see). */
export async function loadLinkOptions(supabase: Supabase, companyId: string): Promise<LinkOptions> {
  const [p, s, c, t, k] = await Promise.all([
    supabase.from("products").select("id, name, sku").eq("company_id", companyId).eq("active", true).order("name").limit(3000),
    supabase.from("suppliers").select("id, name").eq("company_id", companyId).order("name").limit(3000),
    supabase.from("clients").select("id, name").eq("company_id", companyId).order("name").limit(3000),
    supabase.from("tenders").select("id, number, title").eq("company_id", companyId).order("closing_at", { ascending: false }).limit(300),
    supabase.from("contracts").select("id, number, title").eq("company_id", companyId).order("end_date", { ascending: false }).limit(300),
  ]);
  return {
    products: ((p.data ?? []) as { id: string; name: string; sku: string }[]).map((x) => ({ id: x.id, name: `${x.name} (${x.sku})` })),
    suppliers: (s.data ?? []) as Named[],
    clients: (c.data ?? []) as Named[],
    tenders: ((t.data ?? []) as { id: string; number: string; title: string }[]).map((x) => ({ id: x.id, name: `${x.number} · ${x.title}` })),
    contracts: ((k.data ?? []) as { id: string; number: string; title: string }[]).map((x) => ({ id: x.id, name: `${x.number} · ${x.title}` })),
  };
}
