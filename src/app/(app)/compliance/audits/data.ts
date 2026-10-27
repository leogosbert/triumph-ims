import type { createClient } from "@/lib/supabase/server";
import type { PackData } from "@/lib/compliance/audits";
import type { ComplianceItem, Licence } from "@/lib/compliance/model";
import { hasRole, type RoleSet } from "@/lib/roles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Everything the inspection packs check against, in one round of reads. null when the SQL is not run yet. */
export async function loadPackData(supabase: Supabase, companyId: string, today: string, role: RoleSet): Promise<PackData | { missing: true; error: unknown }> {
  const finance = hasRole(role, "management", "finance");
  const sales = finance || hasRole(role, "sales");
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const docKind = (kinds: string[]) =>
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("kind", kinds).is("archived_at", null);

  const [itemsRes, linksRes, licRes, invoices, payroll, sds, coa, insurance, contracts, taxPapers] = await Promise.all([
    supabase.from("compliance_items").select("id, code, status, status_note").eq("company_id", companyId).not("code", "is", null).limit(1000),
    supabase.from("compliance_documents").select("item_id, licence_id").eq("company_id", companyId).limit(5000),
    supabase.from("licences").select("id, name, status, licence_no, expires_on, remind_days, catalogue_code").eq("company_id", companyId).not("catalogue_code", "is", null).limit(1000),
    sales ? count(supabase.from("invoices").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("status", "draft")) : Promise.resolve(0),
    finance ? count(supabase.from("payroll_runs").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["approved", "paid"])) : Promise.resolve(0),
    count(docKind(["sds"])),
    count(docKind(["coa"])),
    count(docKind(["insurance"])),
    count(docKind(["contract"])),
    count(docKind(["tax"])),
  ]);
  if (itemsRes.error) return { missing: true, error: itemsRes.error };

  const items = new Map<string, Pick<ComplianceItem, "id" | "status" | "status_note">>();
  for (const i of (itemsRes.data ?? []) as (Pick<ComplianceItem, "id" | "status" | "status_note"> & { code: string })[]) items.set(i.code, i);
  const docCount = new Map<string, number>();
  const licenceDocs = new Map<string, number>();
  for (const l of (linksRes.data ?? []) as { item_id: string | null; licence_id: string | null }[]) {
    if (l.item_id) docCount.set(l.item_id, (docCount.get(l.item_id) ?? 0) + 1);
    if (l.licence_id) licenceDocs.set(l.licence_id, (licenceDocs.get(l.licence_id) ?? 0) + 1);
  }
  const licences: PackData["licences"] = new Map();
  for (const l of (licRes.data ?? []) as (Pick<Licence, "id" | "name" | "status" | "licence_no" | "expires_on" | "remind_days"> & { catalogue_code: string })[]) {
    licences.set(l.catalogue_code, [...(licences.get(l.catalogue_code) ?? []), l]);
  }
  return {
    today,
    items,
    docCount,
    licences,
    licenceDocs,
    records: { invoices, payroll, sds, coa, insurance, contracts, tax_papers: taxPapers },
  };
}
