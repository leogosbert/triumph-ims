import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { headers } from "next/headers";
import { requireManager } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { outboxStatus } from "@/lib/outbox";
import { ROLE_LABELS, type Role } from "@/lib/roles";

export const metadata = { title: "Go-live checklist" };
export const dynamic = "force-dynamic";

type Item = { ok: boolean | null; label: string; detail?: string; href?: string };

function Row({ i }: { i: Item }) {
  const mark = i.ok === null ? "•" : i.ok ? "✓" : "○";
  return (
    <li>
      <span className={i.ok ? "tick" : i.ok === null ? "muted" : "todo"} aria-hidden="true">
        {mark}
      </span>
      <span>
        {i.href && !i.ok ? <Link href={i.href}>{tr(String(i.label ?? ""))}</Link> : i.ok ? <span className="muted">{tr(String(i.label ?? ""))}</span> : i.label}
        {i.detail && <span className="small muted"> — {i.detail}</span>}
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
  const team = [...roleCount.entries()].map(([r, k]) => `${k} ${ROLE_LABELS[r as Role].toLowerCase()}`).join(", ");
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
        { ok: roleCount.size > 1, label: "Team invited with the right roles", detail: team || "only you so far", href: "/settings/team" },
        { ok: settings.data ? !settings.data.allow_new_companies : null, label: "Public sign-up of new companies switched off", detail: "runbook step 5 (SQL)" },
      ],
    },
    {
      title: "Your data",
      items: [
        { ok: n(clients.count) > 0 && n(suppliers.count) > 0 && n(products.count) > 0, label: "Clients, suppliers and products loaded", detail: `${n(clients.count)} clients, ${n(suppliers.count)} suppliers, ${n(products.count)} products`, href: "/import" },
        { ok: n(products.count) > 0 && n(costs.count) >= n(products.count) * 0.8, label: "Costs on most products (for margins and profit)", detail: `${n(costs.count)} of ${n(products.count)} have a cost`, href: "/products" },
        { ok: missingRates.length === 0, label: "Exchange rates for every foreign currency you use", detail: missingRates.length ? `missing: ${missingRates.join(", ")}` : needRates.length ? `set: ${needRates.join(", ")}` : "none needed yet", href: "/rates" },
        { ok: n(opening.count) > 0, label: "Opening stock loaded", detail: n(opening.count) ? `${n(opening.count)} rows` : "skip if you only buy to order", href: "/stock/import" },
        { ok: null, label: "Test transactions cleared", detail: "runbook step 4 (SQL), once testing is finished" },
      ],
    },
    {
      title: "Alerts",
      items: [
        { ok: status.secret, label: "Server key for alerts (OUTBOX_SECRET)", href: "/settings/notifications" },
        { ok: status.secret && recentCheck, label: "Alert check running", detail: c.alerts_checked_at ? `last ${formatDateTime(c.alerts_checked_at)}` : "never", href: "/settings/notifications" },
        { ok: status.push, label: "Phone notifications (VAPID keys)", href: "/settings/notifications" },
        { ok: status.email, label: "Alert emails (Resend + your domain)", href: "/settings/notifications" },
      ],
    },
    {
      title: "Hosting and safety",
      items: [
        { ok: !host.endsWith(".netlify.app") && !host.startsWith("localhost"), label: "Your own web address", detail: `now: ${host}` },
        { ok: Boolean(siteUrl) && siteUrl.includes(host), label: "NEXT_PUBLIC_SITE_URL matches the web address", detail: siteUrl || "not set" },
        { ok: null, label: "Supabase Auth: Site URL and redirect URLs updated, Confirm email on, custom SMTP", detail: "runbook step 2" },
        { ok: null, label: "Nightly encrypted database backup set up in GitHub", detail: "runbook step 6" },
        { ok: null, label: "GitHub repository set to private", detail: "runbook step 7" },
      ],
    },
  ];

  const auto = groups.flatMap((g) => g.items).filter((i) => i.ok !== null);
  const done = auto.filter((i) => i.ok).length;

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Go-live checklist")}</h1>
      <p className="muted small">
        {done}{" "}{tr("of")}{" "}{auto.length}{" "}{tr("automatic checks done. Items marked • can't be checked from inside the app — follow the go-live runbook (GO-LIVE.md in the project) for those.")}</p>
      {groups.map((g) => (
        <section key={g.title} className="card">
          <h2>{tr(String(g.title ?? ""))}</h2>
          <ul className="list checklist">
            {g.items.map((i) => (
              <Row key={i.label} i={i} />
            ))}
          </ul>
        </section>
      ))}
      <p className="small">
        <Link href="/settings/export">{tr("Export all data →")}</Link>
      </p>
    </>
  );
}
