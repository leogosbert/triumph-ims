import type { createClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/context";
import type { FeatureRow } from "@/lib/features";
import { GUIDE, type GuideTopic } from "@/lib/guide";
import { moreMenu } from "@/lib/menu";
import { formatMoney } from "@/lib/money";
import { cleanSearch } from "@/lib/records";
import { can, type Role } from "@/lib/roles";
import { tr } from "@/lib/tr";
import { words } from "@/lib/ai/knowledge";

/**
 * Search shared by the /search page and the Ask box: screens from the menu, App guide topics and
 * the company's records. Records are read with the signed-in person's access (row-level security)
 * and the same role checks as the screens, so nobody finds more here than they could open.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Features = { on: (key?: string | null) => boolean; list: FeatureRow[] };

export type Hit = { href: string; title: string; sub: string; side?: string };
export type HitGroup = { key: string; title: string; hits: Hit[] };

export type SearchCtx = { supabase: Supabase; company: Company; role: Role; isManager: boolean; isPlatformAdmin?: boolean; features: Features };

// ---------------------------------------------------------------------------------------------
// Screens and guide topics
// ---------------------------------------------------------------------------------------------

const score = (ws: string[], title: string, body: string) => {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let s = 0;
  for (const w of ws) {
    const stem = w.length > 4 ? w.slice(0, -1) : w;
    if (t.includes(stem)) s += 3;
    else if (b.includes(stem)) s += 1;
  }
  return s;
};

/** Screens this person can open, matching the words (in English or in the translated titles). */
export function findPages(ctx: Pick<SearchCtx, "role" | "isManager" | "isPlatformAdmin" | "features">, q: string, limit = 6): Hit[] {
  const ws = words(q);
  if (!ws.length) return [];
  const seen = new Set<string>();
  const out: { hit: Hit; s: number }[] = [];
  for (const cat of moreMenu(ctx.role, ctx.isManager, { on: ctx.features.on, isPlatformAdmin: ctx.isPlatformAdmin, features: ctx.features.list })) {
    for (const i of cat.items) {
      if (i.soon || i.plain || seen.has(i.href)) continue;
      seen.add(i.href);
      const s = score(ws, `${i.title} ${tr(i.title)}`, `${i.sub} ${tr(i.sub)} ${cat.label}`);
      if (s > 0) out.push({ hit: { href: i.href, title: tr(i.title), sub: tr(i.sub), side: tr(cat.label) }, s });
    }
  }
  return out
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.hit);
}

function guideAllowed(t: GuideTopic, role: Role, isManager: boolean, on: (k?: string | null) => boolean) {
  if (t.feature && !on(t.feature)) return false;
  if (t.roles === "all") return true;
  if (t.roles === "managers") return isManager;
  return t.roles.includes(role);
}

export type GuideHit = { topic: GuideTopic; section: string; score: number };

/** App guide topics for "how do I…" questions, only those for this person's role and features. */
export function findGuide(ctx: Pick<SearchCtx, "role" | "isManager" | "features">, q: string, limit = 3): GuideHit[] {
  const ws = words(q);
  if (!ws.length) return [];
  const out: GuideHit[] = [];
  for (const sec of GUIDE) {
    for (const t of sec.topics) {
      if (!guideAllowed(t, ctx.role, ctx.isManager, ctx.features.on)) continue;
      const s = score(ws, `${t.title} ${tr(t.title)}`, `${t.summary} ${tr(t.summary)} ${t.steps.join(" ")} ${(t.tips ?? []).join(" ")}`);
      if (s >= 2) out.push({ topic: t, section: sec.title, score: s });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const guideHref = (t: GuideTopic) => `/guide#${t.id}`;

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/** The record search of /search: clients, suppliers, products, RFQs, quotations, POs, deliveries, invoices. */
export async function findRecords(ctx: Pick<SearchCtx, "supabase" | "company" | "role">, raw: string, per = 6): Promise<HitGroup[]> {
  const q = cleanSearch(raw);
  if (q.length < 2) return [];
  const { supabase, company, role } = ctx;
  const like = `%${q}%`;
  const none = Promise.resolve({ data: null });
  const [clients, suppliers, products, rfqs, quotes, pos, dns, invoices] = await Promise.all([
    supabase.from("clients").select("id, name, code, industry").eq("company_id", company.id).or(`name.ilike.${like},code.ilike.${like},tin.ilike.${like}`).limit(per + 2),
    can(role, "seeSuppliers")
      ? supabase.from("suppliers").select("id, name, code, country").eq("company_id", company.id).or(`name.ilike.${like},code.ilike.${like}`).limit(per + 2)
      : none,
    supabase
      .from("products")
      .select("id, name, sku, brand, mfr_part_no")
      .eq("company_id", company.id)
      .or(`name.ilike.${like},sku.ilike.${like},mfr_part_no.ilike.${like},brand.ilike.${like}`)
      .limit(per + 4),
    can(role, "seeSales")
      ? supabase.from("rfqs").select("id, number, title, status, client:clients(name)").eq("company_id", company.id).or(`number.ilike.${like},title.ilike.${like},client_ref.ilike.${like}`).limit(per)
      : none,
    can(role, "seeSales")
      ? supabase
          .from("quotations")
          .select("id, number, revision, status, total, currency, client:clients(name)")
          .eq("company_id", company.id)
          .or(`number.ilike.${like},client_ref.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(per)
      : none,
    can(role, "seePurchasing")
      ? supabase
          .from("purchase_orders")
          .select("id, number, status, total, currency, supplier:suppliers(name)")
          .eq("company_id", company.id)
          .or(`number.ilike.${like},supplier_ref.ilike.${like}`)
          .limit(per)
      : none,
    can(role, "seeDeliveries") ? supabase.from("deliveries").select("id, number, status, client:clients(name)").eq("company_id", company.id).ilike("number", like).limit(per) : none,
    can(role, "seeInvoices")
      ? supabase
          .from("invoices")
          .select("id, number, status, total, currency, client:clients(name)")
          .eq("company_id", company.id)
          .or(`number.ilike.${like},client_ref.ilike.${like}`)
          .limit(per)
      : none,
  ]);
  type R = Record<string, unknown> & { id: string };
  const rows = (r: { data: unknown }) => (r.data ?? []) as R[];
  const name = (v: unknown) => (v as { name?: string } | null)?.name ?? "";
  const groups: HitGroup[] = [
    { key: "clients", title: "Clients", hits: rows(clients).map((c) => ({ href: `/clients/${c.id}`, title: String(c.name), sub: [c.code, c.industry].filter(Boolean).join(" · ") })) },
    { key: "products", title: "Products", hits: rows(products).map((p) => ({ href: `/products/${p.id}`, title: String(p.name), sub: [p.sku, p.brand, p.mfr_part_no].filter(Boolean).join(" · ") })) },
    { key: "suppliers", title: "Suppliers", hits: rows(suppliers).map((s) => ({ href: `/suppliers/${s.id}`, title: String(s.name), sub: [s.code, s.country].filter(Boolean).join(" · ") })) },
    { key: "rfqs", title: "Client RFQs", hits: rows(rfqs).map((r) => ({ href: `/rfqs/${r.id}`, title: name(r.client), sub: [r.number, r.title].filter(Boolean).join(" · ") })) },
    {
      key: "quotations",
      title: "Quotations",
      hits: rows(quotes).map((x) => ({
        href: `/quotations/${x.id}`,
        title: name(x.client),
        sub: Number(x.revision) > 0 ? `${x.number}-R${x.revision}` : String(x.number),
        side: formatMoney(x.total as number, String(x.currency)),
      })),
    },
    { key: "pos", title: "Purchase orders", hits: rows(pos).map((x) => ({ href: `/purchase-orders/${x.id}`, title: name(x.supplier), sub: String(x.number), side: formatMoney(x.total as number, String(x.currency)) })) },
    { key: "deliveries", title: "Deliveries", hits: rows(dns).map((x) => ({ href: `/deliveries/${x.id}`, title: name(x.client), sub: String(x.number) })) },
    {
      key: "invoices",
      title: "Invoices",
      hits: rows(invoices).map((x) => ({ href: `/invoices/${x.id}`, title: name(x.client), sub: String(x.number || "Draft"), side: formatMoney(x.total as number, String(x.currency)) })),
    },
  ];
  return groups.filter((g) => g.hits.length > 0);
}
