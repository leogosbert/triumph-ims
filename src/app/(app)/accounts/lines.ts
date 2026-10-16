import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/** A journal line with its journal, as selected with `gl_journals!inner(...)`. */
export type LedgerLine = {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  client_id: string | null;
  supplier_id: string | null;
  gl_journals: {
    id: string;
    number: string;
    entry_date: string;
    doc_date: string | null;
    source: string;
    source_ref: string | null;
    memo: string | null;
  };
};

/** Client and supplier names for the lines that carry one. */
export async function partyNames(supabase: Db, lines: { client_id: string | null; supplier_id: string | null }[]): Promise<Map<string, string>> {
  const cl = [...new Set(lines.map((l) => l.client_id).filter((x): x is string => !!x))].slice(0, 300);
  const su = [...new Set(lines.map((l) => l.supplier_id).filter((x): x is string => !!x))].slice(0, 300);
  const [c, s] = await Promise.all([
    cl.length ? supabase.from("clients").select("id, name").in("id", cl) : Promise.resolve({ data: [] }),
    su.length ? supabase.from("suppliers").select("id, name").in("id", su) : Promise.resolve({ data: [] }),
  ]);
  const m = new Map<string, string>();
  for (const r of [...((c.data ?? []) as { id: string; name: string }[]), ...((s.data ?? []) as { id: string; name: string }[])]) m.set(r.id, r.name);
  return m;
}
