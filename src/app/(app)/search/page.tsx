import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getAppContext } from "@/lib/context";
import { getDict } from "@/lib/lang";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch } from "@/lib/records";
import { can } from "@/lib/roles";

export const metadata = { title: "Search" };

type Hit = { href: string; title: string; sub: string; side?: string };

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, role } = await getAppContext();
  const { t } = await getDict();
  const like = `%${q}%`;
  const groups: { title: string; hits: Hit[] }[] = [];

  if (q.length >= 2) {
    const none = Promise.resolve({ data: null });
    const [clients, suppliers, products, rfqs, quotes, pos, dns, invoices] = await Promise.all([
      supabase.from("clients").select("id, name, code, industry").eq("company_id", company.id).or(`name.ilike.${like},code.ilike.${like},tin.ilike.${like}`).limit(8),
      can(role, "seeSuppliers")
        ? supabase.from("suppliers").select("id, name, code, country").eq("company_id", company.id).or(`name.ilike.${like},code.ilike.${like}`).limit(8)
        : none,
      supabase
        .from("products")
        .select("id, name, sku, brand, mfr_part_no")
        .eq("company_id", company.id)
        .or(`name.ilike.${like},sku.ilike.${like},mfr_part_no.ilike.${like},brand.ilike.${like}`)
        .limit(10),
      can(role, "seeSales")
        ? supabase.from("rfqs").select("id, number, title, status, client:clients(name)").eq("company_id", company.id).or(`number.ilike.${like},title.ilike.${like},client_ref.ilike.${like}`).limit(6)
        : none,
      can(role, "seeSales")
        ? supabase
            .from("quotations")
            .select("id, number, revision, status, total, currency, client:clients(name)")
            .eq("company_id", company.id)
            .or(`number.ilike.${like},client_ref.ilike.${like}`)
            .order("created_at", { ascending: false })
            .limit(6)
        : none,
      can(role, "seePurchasing")
        ? supabase
            .from("purchase_orders")
            .select("id, number, status, total, currency, supplier:suppliers(name)")
            .eq("company_id", company.id)
            .or(`number.ilike.${like},supplier_ref.ilike.${like}`)
            .limit(6)
        : none,
      can(role, "seeDeliveries")
        ? supabase.from("deliveries").select("id, number, status, client:clients(name)").eq("company_id", company.id).ilike("number", like).limit(6)
        : none,
      can(role, "seeInvoices")
        ? supabase
            .from("invoices")
            .select("id, number, status, total, currency, client:clients(name)")
            .eq("company_id", company.id)
            .or(`number.ilike.${like},client_ref.ilike.${like}`)
            .limit(6)
        : none,
    ]);
    type R = Record<string, unknown> & { id: string };
    const rows = (r: { data: unknown }) => (r.data ?? []) as R[];
    const name = (v: unknown) => (v as { name?: string } | null)?.name ?? "";
    groups.push(
      { title: t["s.clients"], hits: rows(clients).map((c) => ({ href: `/clients/${c.id}`, title: String(c.name), sub: [c.code, c.industry].filter(Boolean).join(" · ") })) },
      { title: t["s.products"], hits: rows(products).map((p) => ({ href: `/products/${p.id}`, title: String(p.name), sub: [p.sku, p.brand, p.mfr_part_no].filter(Boolean).join(" · ") })) },
      { title: t["s.suppliers"], hits: rows(suppliers).map((s) => ({ href: `/suppliers/${s.id}`, title: String(s.name), sub: [s.code, s.country].filter(Boolean).join(" · ") })) },
      { title: t["s.rfqs"], hits: rows(rfqs).map((r) => ({ href: `/rfqs/${r.id}`, title: name(r.client), sub: [r.number, r.title].filter(Boolean).join(" · ") })) },
      {
        title: t["s.quotations"],
        hits: rows(quotes).map((x) => ({
          href: `/quotations/${x.id}`,
          title: name(x.client),
          sub: Number(x.revision) > 0 ? `${x.number}-R${x.revision}` : String(x.number),
          side: formatMoney(x.total as number, String(x.currency)),
        })),
      },
      { title: t["s.pos"], hits: rows(pos).map((x) => ({ href: `/purchase-orders/${x.id}`, title: name(x.supplier), sub: String(x.number), side: formatMoney(x.total as number, String(x.currency)) })) },
      { title: t["s.deliveries"], hits: rows(dns).map((x) => ({ href: `/deliveries/${x.id}`, title: name(x.client), sub: String(x.number) })) },
      {
        title: t["s.invoices"],
        hits: rows(invoices).map((x) => ({ href: `/invoices/${x.id}`, title: name(x.client), sub: String(x.number || "Draft"), side: formatMoney(x.total as number, String(x.currency)) })),
      },
    );
  }
  const found = groups.filter((g) => g.hits.length > 0);

  return (
    <>
      <h1>{t["s.title"]}</h1>
      <form className="search-big" role="search">
        <Icon name="search" />
        <input type="search" name="q" defaultValue={q} placeholder={t["shell.searchPlaceholder"]} autoFocus aria-label={t["s.title"]} />
      </form>
      {q.length < 2 ? (
        <p className="muted small">{t["s.hint"]}</p>
      ) : found.length === 0 ? (
        <p className="card muted">{t["s.none"]}</p>
      ) : (
        found.map((g) => (
          <section key={g.title}>
            <h2 className="search-group">{g.title}</h2>
            <ul className="rec-list">
              {g.hits.map((h) => (
                <li key={h.href}>
                  <Link href={h.href}>
                    <div className="main">
                      <div className="title">{h.title}</div>
                      <div className="sub">{h.sub}</div>
                    </div>
                    {h.side && <div className="side num small">{h.side}</div>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
