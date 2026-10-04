import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Carousel } from "@/components/Carousel";
import { CountUp } from "@/components/CountUp";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { AgingChart, BarList, ControlTower, KpiGrid, SalesChart } from "@/components/Dashboard";
import { loadDashboard } from "@/lib/dashboard";
import { Icon, type IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/lang";

export const metadata = { title: "Home" };


function greeting(t: Dict) {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(
      new Date(),
    ),
  );
  if (h < 12) return t["home.morning"];
  if (h < 17) return t["home.afternoon"];
  return t["home.evening"];
}

function quickActions(role: Parameters<typeof can>[0], t: Dict) {
  const all: { show: boolean; href: string; label: string; icon: IconName }[] = [
    { show: can(role, "editSales"), href: "/rfqs/new", label: t["qa.rfq"], icon: "plus" },
    { show: can(role, "editSales"), href: "/quotations/new", label: t["qa.quote"], icon: "doc" },
    { show: can(role, "editPurchasing"), href: "/purchase-orders/new", label: t["qa.po"], icon: "purchasing" },
    { show: can(role, "receiveGoods"), href: "/receiving", label: t["qa.receive"], icon: "stock" },
    { show: can(role, "editDeliveries"), href: "/deliveries/new", label: t["qa.deliver"], icon: "deliveries" },
    { show: can(role, "editInvoices"), href: "/invoices/new", label: t["qa.invoice"], icon: "doc" },
    { show: can(role, "editInvoices"), href: "/invoices?tab=unpaid", label: t["qa.payment"], icon: "cash" },
    { show: can(role, "seeStock"), href: "/stock", label: t["qa.stock"], icon: "stock" },
  ];
  return all.filter((a) => a.show).slice(0, 4);
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, profile, company, role, isManager, user } = await getAppContext();
  if (role === "driver") redirect("/driver");
  const firstName = displayName(profile).split(" ")[0];
  // Check for time-based alerts (at most every 30 minutes; harmless before the Stage 7 update).
  await supabase.rpc("refresh_alerts", { p_company: company.id });
  const { t } = await getDict();
  const dash = await loadDashboard(supabase, company.id, role, t);
  const heroKpis = dash.kpis.slice(0, 2);
  const restKpis = dash.kpis.slice(2);
  const actions = quickActions(role, t);
  const today = new Intl.DateTimeFormat(t.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const base = company.base_currency;

  let checklist: { done: boolean; label: string; href: string }[] = [];
  if (isManager) {
    const [{ count: members }, { count: invites }, { count: clientCount }] = await Promise.all([
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      supabase.from("invitations").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    ]);
    checklist = [
      {
        done: Boolean(company.tin && company.address && company.phone),
        label: "Add company details (TIN, address, phone)",
        href: "/settings/company",
      },
      { done: Boolean(company.logo_path), label: "Upload your logo and set your colours", href: "/settings/company#branding" },
      { done: Boolean(company.bank_details), label: "Add bank details for quotations and invoices", href: "/settings/company#documents" },
      { done: (members ?? 0) > 1 || (invites ?? 0) > 0, label: "Invite your team", href: "/settings/team" },
      { done: (clientCount ?? 0) > 0, label: "Load your clients, suppliers and products", href: "/import" },
    ];
  }
  const remaining = checklist.filter((c) => !c.done).length;

  type Pending = { id: string; number: string; revision: number; total: number; currency: string; client: { name: string } | null };
  let approvals: Pending[] = [];
  if (can(role, "approveQuotes")) {
    const { data } = await supabase
      .from("quotations")
      .select("id, number, revision, total, currency, submitted_by, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .neq("submitted_by", user.id)
      .order("submitted_at")
      .limit(10);
    approvals = (data ?? []) as unknown as Pending[];
  }
  type PendingPo = { id: string; number: string; total: number; currency: string; supplier: { name: string } | null };
  let poApprovals: PendingPo[] = [];
  if (can(role, "approvePOs")) {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, number, total, currency, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .neq("submitted_by", user.id)
      .order("submitted_at")
      .limit(10);
    poApprovals = (data ?? []) as unknown as PendingPo[];
  }

  const shortMoney = (v: number) => {
    const x = Math.abs(v);
    return x >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : x >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v));
  };

  return (
    <>
      <section className="hero">
        <div className="hero-date">{today}</div>
        <h1>
          {greeting(t)}, {firstName}
        </h1>
        {heroKpis.length > 0 && (
          <div className="hero-kpis">
            {heroKpis.map((k) => (
              <Link key={k.label} href={k.href ?? "/"}>
                <span className="num">{k.money ? `${base} ${shortMoney(k.value)}` : `${k.value.toLocaleString("en-GB")}${k.suffix ?? ""}`}</span>
                <span>{tr(String(k.label ?? ""))}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <div className="hero-overlap">
        <Notice {...notice} />
        <ControlTower tower={dash.tower} t={t} />
      </div>

      {(approvals.length > 0 || poApprovals.length > 0) && (
        <section className="card">
          <h2>{t["home.waiting"]}</h2>
          <ul className="waitlist">
            {approvals.map((q) => (
              <li key={q.id}>
                <Link href={`/quotations/${q.id}`}>
                  <span>
                    <strong>{q.client?.name ?? tr("Client")}</strong>
                    <span>{q.revision > 0 ? `${q.number}-R${q.revision}` : q.number}</span>
                  </span>
                  <span className="num">{formatMoney(q.total, q.currency)}</span>
                </Link>
              </li>
            ))}
            {poApprovals.map((p) => (
              <li key={p.id}>
                <Link href={`/purchase-orders/${p.id}`}>
                  <span>
                    <strong>{p.supplier?.name ?? tr("Supplier")}</strong>
                    <span>{p.number}</span>
                  </span>
                  <span className="num">{formatMoney(p.total, p.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {actions.length > 0 && (
        <section className="quick">
          <h2>{t["home.quickActions"]}</h2>
          <div className="quick-grid">
            {actions.map((a) => (
              <Link key={a.href} href={a.href}>
                <span className="quick-icon">
                  <Icon name={a.icon} />
                </span>
                {tr(String(a.label ?? ""))}
              </Link>
            ))}
          </div>
        </section>
      )}

      {(() => {
        const slides = [
          restKpis.length > 0 && (
            <section className="card stat-slide" key="kpis">
              <h2>{tr("Key figures")}</h2>
              <KpiGrid kpis={restKpis} currency={base} />
            </section>
          ),
          dash.months && dash.months.some((m) => m.sales > 0) && <SalesChart key="sales" months={dash.months} currency={base} t={t} />,
          dash.aging && <AgingChart key="aging" aging={dash.aging} currency={base} title={t["c.aging"]} />,
          dash.industries && dash.industries.length > 0 && (
            <BarList key="ind" title={t["c.industry"]} sub={t["c.thisYear"]} rows={dash.industries} currency={base} href="/profit" />
          ),
          dash.clients && dash.clients.length > 0 && (
            <BarList key="cli" title={t["c.topClients"]} sub={t["c.thisYear"]} rows={dash.clients} currency={base} href="/profit" />
          ),
        ].filter(Boolean);
        return slides.length > 0 ? (
          <section className="stats-block">
            <h2>{tr("Statistics")}</h2>
            <Carousel label={tr("Statistics")}>{slides}</Carousel>
          </section>
        ) : null;
      })()}
      <CountUp selector=".hero-kpis .num, .stat .n" />

      {isManager && remaining > 0 && (
        <section className="card">
          <h2>{t["home.setup"]}</h2>
          <p className="muted small">
            {remaining} / {checklist.length} {t["home.setupLeft"]}
          </p>
          <ul className="list checklist">
            {checklist.map((c) => (
              <li key={c.label}>
                <span className={c.done ? "tick" : "todo"} aria-hidden="true">
                  {c.done ? "✓" : "○"}
                </span>
                {c.done ? <span className="muted">{tr(String(c.label ?? ""))}</span> : <Link href={c.href}>{tr(String(c.label ?? ""))}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
