import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { headers } from "next/headers";
import { requireManager } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { outboxStatus } from "@/lib/outbox";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { SettingsHead } from "../SettingsHead";

export const metadata = { title: "Go-live checklist" };
export const dynamic = "force-dynamic";

type Item = { ok: boolean | null; label: string; detail?: string; href?: string };

function Row({ i }: { i: Item }) {
  const mark = i.ok === null ? "•" : i.ok ? "✓" : "!";
  const label = tr(i.label);
  return (
    <li>
      <span className={`mark ${i.ok ? "ok" : i.ok === null ? "" : "todo"}`} aria-label={i.ok ? tr("Done") : i.ok === null ? tr("Not checked") : tr("To do")}>
        {mark}
      </span>
      <span className="what">
        {i.href && !i.ok ? <Link href={i.href}>{label}</Link> : <span className={i.ok ? "muted" : undefined}>{label}</span>}
        {i.detail && <span className="small muted">{i.detail}</span>}
      </span>
    </li>
  );
}

export default async function GoLivePage() {
  await primeLang();
  const { supabase, company } = await requireManager();
  const c = company as typeof company & { alerts_checked_at?: string | null };
  const host = (await headers()).get("host") ?? "";
  const n = (v: number | null) => v ?? 0;

  const [members, clients, suppliers, products, costs, opening, rates, supCcy, cliCcy, settings] = await Promise.all([
    supabase.from("memberships").select("role").eq("company_id", company.id).eq("active", true),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("product_costs").select("product_id", { count: "exact", head: true }).eq("company_id", company.id).not("last_cost", "is", null),
    supabase.from("stock_movements").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("note", "Opening stock"),
    supabase.from("exchange_rates").select("currency").eq("company_id", company.id),
    supabase.from("suppliers").select("currency").eq("company_id", company.id).neq("currency", company.base_currency),
    supabase.from("clients").select("currency").eq("company_id", company.id).neq("currency", company.base_currency),
    supabase.from("platform_settings").select("allow_new_companies").maybeSingle(),
  ]);

  const roleCount = new Map<string, number>();
  for (const m of (members.data ?? []) as { role: string }[]) roleCount.set(m.role, (roleCount.get(m.role) ?? 0) + 1);
  const team = [...roleCount.entries()].map(([r, k]) => `${k} ${tr(ROLE_LABELS[r as Role]).toLowerCase()}`).join(", ");
  const haveRates = new Set(((rates.data ?? []) as { currency: string }[]).map((r) => r.currency));
  const needRates = [...new Set([...((supCcy.data ?? []) as { currency: string }[]), ...((cliCcy.data ?? []) as { currency: string }[])].map((x) => x.currency))];
  const missingRates = needRates.filter((x) => !haveRates.has(x));
  const status = outboxStatus();
  const recentCheck = c.alerts_checked_at ? Date.now() - Date.parse(c.alerts_checked_at) < 60 * 60 * 1000 : false;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const groups: { title: string; items: Item[] }[] = [
    {
      title: "Company and documents",
      items: [
        { ok: Boolean(company.tin && company.vrn && company.address && company.phone && company.email), label: "TIN, VRN, address, phone and email filled in", href: "/settings/company" },
        { ok: Boolean(company.logo_path), label: "Logo uploaded and colours set", href: "/settings/company#branding" },
        { ok: Boolean(company.bank_details), label: "Bank details for quotations and invoices", href: "/settings/company#documents" },
        { ok: Boolean(company.quote_terms && company.po_terms), label: "Standard quotation and PO terms", href: "/settings/company" },
      ],
    },
    {
      title: "People",
      items: [
        { ok: roleCount.size > 1, label: "Team invited with the right roles", detail: team || tr("only you so far"), href: "/settings/team" },
        { ok: settings.data ? !settings.data.allow_new_companies : null, label: "Public sign-up of new companies switched off", detail: tr("runbook step 5 (SQL)") },
      ],
    },
    {
      title: "Your data",
      items: [
        { ok: n(clients.count) > 0 && n(suppliers.count) > 0 && n(products.count) > 0, label: "Clients, suppliers and products loaded", detail: `${n(clients.count)} clients, ${n(suppliers.count)} suppliers, ${n(products.count)} products`, href: "/import" },
        { ok: n(products.count) > 0 && n(costs.count) >= n(products.count) * 0.8, label: "Costs on most products (for margins and profit)", detail: `${n(costs.count)} of ${n(products.count)} have a cost`, href: "/products" },
        { ok: missingRates.length === 0, label: "Exchange rates for every foreign currency you use", detail: missingRates.length ? `missing: ${missingRates.join(", ")}` : needRates.length ? `set: ${needRates.join(", ")}` : tr("none needed yet"), href: "/rates" },
        { ok: n(opening.count) > 0, label: "Opening stock loaded", detail: n(opening.count) ? `${n(opening.count)} rows` : tr("skip if you only buy to order"), href: "/stock/import" },
        { ok: null, label: "Test transactions cleared", detail: tr("runbook step 4 (SQL), once testing is finished") },
      ],
    },
    {
      title: "Alerts",
      items: [
        { ok: status.secret, label: "Server key for alerts (OUTBOX_SECRET)", href: "/settings/notifications" },
        { ok: status.secret && recentCheck, label: "Alert check running", detail: c.alerts_checked_at ? `last ${formatDateTime(c.alerts_checked_at)}` : tr("never"), href: "/settings/notifications" },
        { ok: status.push, label: "Phone notifications (VAPID keys)", href: "/settings/notifications" },
        { ok: status.email, label: "Alert emails (Resend + your domain)", href: "/settings/notifications" },
      ],
    },
    {
      title: "Hosting and safety",
      items: [
        { ok: !host.endsWith(".netlify.app") && !host.startsWith("localhost"), label: "Your own web address", detail: `now: ${host}` },
        { ok: Boolean(siteUrl) && siteUrl.includes(host), label: "NEXT_PUBLIC_SITE_URL matches the web address", detail: siteUrl || tr("not set") },
        { ok: null, label: "Supabase Auth: Site URL and redirect URLs updated, Confirm email on, custom SMTP", detail: tr("runbook step 2") },
        { ok: null, label: "Nightly encrypted database backup set up in GitHub", detail: tr("runbook step 6") },
        { ok: null, label: "GitHub repository set to private", detail: tr("runbook step 7") },
      ],
    },
  ];

  const auto = groups.flatMap((g) => g.items).filter((i) => i.ok !== null);
  const done = auto.filter((i) => i.ok).length;

  const pct = auto.length ? Math.round((done / auto.length) * 100) : 0;

  return (
    <>
      <SettingsHead
        title={tr("Go-live checklist")}
        icon="check"
        lead={tr("What is ready and what is left before everyone starts")}
        side={<span className={`badge ${done === auto.length ? "tone-ok" : "tone-warn"}`}>{`${done} / ${auto.length}`}</span>}
      />
      <section className="card" id="progress">
        <strong>{tr("{done} of {total} automatic checks done").replace("{done}", String(done)).replace("{total}", String(auto.length))}</strong>
        <div className="st-progress" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {tr("Items marked • can't be checked from inside the app. Follow the go-live runbook (GO-LIVE.md in the project) for those.")}
        </p>
      </section>
      {groups.map((g) => {
        const okCount = g.items.filter((i) => i.ok).length;
        const checkable = g.items.filter((i) => i.ok !== null).length;
        return (
          <section key={g.title} className="card">
            <div className="st-card-head">
              <h2>{tr(g.title)}</h2>
              {checkable > 0 && (
                <span className={`badge ${okCount === checkable ? "tone-ok" : "tone-off"}`}>{`${okCount} / ${checkable}`}</span>
              )}
            </div>
            <ul className="list st-check">
              {g.items.map((i) => (
                <Row key={i.label} i={i} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="small">
        <Link href="/settings/export">{tr("Export all data →")}</Link>
      </p>
    </>
  );
}
