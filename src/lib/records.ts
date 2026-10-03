import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Inserts or updates one record of the signed-in company. */
export async function saveRecord(
  supabase: Supabase,
  table: string,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const v = { ...values };
  if (id) {
    // An empty code/SKU on an existing record means "keep the current one".
    if (v.code === "") delete v.code;
    if (v.sku === "") delete v.sku;
    const { data, error } = await supabase
      .from(table)
      .update(v)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id")
      .single();
    if (error) return { error: error.message };
    return { id: (data as { id: string }).id };
  }
  const { data, error } = await supabase
    .from(table)
    .insert({ ...v, company_id: companyId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Removes characters that would break a search filter. */
export function cleanSearch(q: string | undefined) {
  return (q ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

export const LIST_LIMIT = 100;
