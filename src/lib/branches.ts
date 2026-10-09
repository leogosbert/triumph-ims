import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Branch = { id: string; name: string; code: string | null; address: string | null; phone: string | null; manager_id: string | null; active: boolean };

/** The company's branches, or [] when there are none (or the Stage 15 SQL has not been run). */
export async function branchList(supabase: Supabase, companyId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, code, address, phone, manager_id, active")
    .eq("company_id", companyId)
    .order("name");
  if (error) return [];
  return (data ?? []) as Branch[];
}

/** Documents that can be moved to another branch, with the table and the page they live on. */
export const BRANCH_DOCS = {
  quotation: { table: "quotations", path: "/quotations/" },
  invoice: { table: "invoices", path: "/invoices/" },
  purchase_order: { table: "purchase_orders", path: "/purchase-orders/" },
  expense: { table: "expenses", path: "/expenses/" },
} as const;
export type BranchDoc = keyof typeof BRANCH_DOCS;

/** Approval roles for steps (drivers and sales do not approve purchase orders). */
export const STEP_ROLES = ["finance", "procurement", "warehouse", "management"] as const;
