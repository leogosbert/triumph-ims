import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { AppBackground } from "@/components/AppBackground";
import { LangSwitch } from "@/components/LangSwitch";
import { CATEGORIES, priceText, type PriceItem } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/user";

export const metadata = {
  title: "Prices",
  description: "LeMoSp plans and services for Tanzanian suppliers: Small, Medium and Enterprise, add-ons, training and setup. Prices in TZS and USD, excluding VAT.",
};

type Row = Omit<PriceItem, "feature_keys" | "playbook_id" | "requestable" | "public" | "active">;

/** Public price page: the plans and the services LeMo Tech marks as public (public_price_list). */
export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const currency: "TZS" | "USD" = sp.cur === "USD" ? "USD" : "TZS";
  const supabase = await createClient();
  const [{ data, error }, user] = await Promise.all([supabase.rpc("public_price_list"), getSessionUser(supabase)]);
  const items = ((data ?? []) as Row[]).map((i) => ({
    ...i,
    price_tzs: i.price_tzs === null ? null : Number(i.price_tzs),
    price_usd: i.price_usd === null ? null : Number(i.price_usd),
    feature_keys: [],
    playbook_id: null,
    requestable: true,
    public: true,
    active: true,
  })) as PriceItem[];
  const plans = items.filter((i) => i.category === "plan");
  const t = (s: string) => tr(s);

  return (
    <div className="auth-wrap journey-wrap pb-list-wrap">
      <AppBackground kind="architecture" />
      <header className="j-head">
        <Link href={user ? "/" : "/login"} className="j-logo" aria-label={tr("LeMoSp")}>
          <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
        </Link>
        <LangSwitch />
      </header>
      <div className="j-intro">
        <p className="j-eyebrow">{tr("Prices")}</p>
        <h1>{tr("One platform that grows with your business")}</h1>
        <p>{tr("Pick the plan that matches your business level today. Switch single features on as add-ons, and move up when you grow: nothing is ever lost. Prices exclude VAT.")}</p>
        <p>
          <span className="sv-cur" role="group" aria-label={tr("Currency")}>
            {(["TZS", "USD"] as const).map((c) => (
              <Link key={c} href={`/pricing?cur=${c}`} aria-current={currency === c ? "true" : undefined}>
                {c}
              </Link>
            ))}
          </span>{" "}
          {currency === "USD" && <span className="small">{tr("USD prices are for companies outside Tanzania.")}</span>}
        </p>
      </div>

      {error || items.length === 0 ? (
        <p className="pr-list">{tr("Prices will be published here soon. Ask LeMo Tech for a quotation.")}</p>
      ) : (
        <>
          <div className="pr-plans">
            {plans.map((p) => {
              const v = currency === "USD" ? p.price_usd : p.price_tzs;
              return (
                <article key={p.key} className="pr-plan">
                  <h2>{tr(p.name)}</h2>
                  <div className="pr-amt">{v === null ? tr("Price on request") : formatMoney(v, currency)}</div>
                  <span className="small">{tr("per company, per month")}</span>
                  <p>{tr(p.description)}</p>
                </article>
              );
            })}
          </div>
          {CATEGORIES.filter((c) => c.key !== "plan").map((c) => {
            const list = items.filter((i) => i.category === c.key);
            if (list.length === 0) return null;
            return (
              <section key={c.key} className="pr-list">
                <h2>{tr(c.title)}</h2>
                <table className="bl-table">
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.key}>
                        <td>
                          <strong>{tr(i.name)}</strong>
                          {i.description && <div className="small muted">{tr(i.description)}</div>}
                        </td>
                        <td className="num">{priceText(i, currency, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
          <p className="pr-list small">
            {tr("Free 48-hour demo, then a 30-day free trial on your own data. Annual payment: 12 months for the price of 10. Quarterly: 5% off. Mobile money and bank transfer accepted.")}
          </p>
        </>
      )}
      <p className="auth-links">
        <Link href={user ? "/services" : "/how-it-works"}>{user ? tr("Request a service for your company") : tr("See how LeMoSp works, step by step")} ›</Link>
      </p>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
