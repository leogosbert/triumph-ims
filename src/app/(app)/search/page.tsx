import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { AskPanel } from "@/components/ai/AskPanel";
import { Icon } from "@/components/Icon";
import { findGuide, findPages, findRecords, guideHref, type Hit } from "@/lib/ai/search";
import { getAppContext } from "@/lib/context";
import { getDict } from "@/lib/lang";
import { type SearchParams } from "@/lib/messages";
import { cleanSearch } from "@/lib/records";

export const metadata = { title: "Search" };

const GROUP_KEY: Record<string, string> = {
  clients: "s.clients",
  products: "s.products",
  suppliers: "s.suppliers",
  rfqs: "s.rfqs",
  quotations: "s.quotations",
  pos: "s.pos",
  deliveries: "s.deliveries",
  invoices: "s.invoices",
};

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const asked = (typeof sp.q === "string" ? sp.q : "").replace(/\s+/g, " ").trim().slice(0, 500);
  const q = cleanSearch(asked);
  // A question (not a name or number) is answered straight away; a plain search shows an "Ask AI" button.
  const auto = sp.ask === "1" || /\?$/.test(asked) || asked.split(" ").length >= 4;
  const { supabase, company, role, isManager, isPlatformAdmin, features } = await getAppContext();
  const { t } = await getDict();
  const ctx = { supabase, company, role, isManager, isPlatformAdmin, features: { on: features.on, list: features.list } };

  const groups: { title: string; hits: Hit[] }[] = [];
  if (q.length >= 2) {
    const records = await findRecords(ctx, q);
    const screens = [
      ...findPages(ctx, asked, 6),
      ...findGuide(ctx, asked, 4).map((g) => ({ href: g.topic.href ?? guideHref(g.topic), title: tr(g.topic.title), sub: tr(g.topic.summary), side: tr("App guide") })),
    ];
    if (screens.length) groups.push({ title: tr("Screens and guide"), hits: screens });
    for (const g of records) groups.push({ title: (t as Record<string, string>)[GROUP_KEY[g.key]] ?? tr(g.title), hits: g.hits });
  }

  return (
    <>
      <h1>{t["s.title"]}</h1>
      <form className="search-big" role="search">
        <Icon name="search" />
        <input type="search" name="q" defaultValue={asked} placeholder={tr("Search or ask anything about the business")} autoFocus={!asked} aria-label={t["s.title"]} maxLength={500} />
      </form>
      {q.length < 2 ? (
        <p className="muted small">
          {t["s.hint"]} {tr("Or ask a question, for example: what documents do I need to supply a mine? When is VAT due? How do I record an expense?")}
        </p>
      ) : (
        <>
          <AskPanel question={asked} auto={auto} />
          {groups.length === 0 ? (
            <p className="card muted">{t["s.none"]}</p>
          ) : (
            groups.map((g) => (
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
      )}
    </>
  );
}
