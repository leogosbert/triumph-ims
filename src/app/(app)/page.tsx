import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Suspense } from "react";
import { SkeletonCard } from "@/components/Skeleton";
import { Carousel } from "@/components/Carousel";
import { MoneyFig } from "@/components/MoneyFig";
import { HomeCustomise, HomeFlow, HomeHeroTiles, HomeKeyFigures, HomePrefsProvider, type HomeSectionMeta, type HomeSectionNode } from "@/components/home/HomePrefs";
import { layoutKey } from "@/lib/homeLayout";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, withNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can, onlyRoles } from "@/lib/roles";
import { AgingChart, BarList, ControlTower, SalesChart } from "@/components/Dashboard";
import { loadDashboard } from "@/lib/dashboard";
import { backupTowerItem } from "@/lib/backups";
import { Icon, type IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/lang";
import { FirstStepsCard, GrowthCard, OnboardingCard } from "@/components/GrowthCard";
import { loadRecommendations } from "@/lib/features";
import { TourInvite } from "@/components/tour/TourButton";
import { isLevel, levelRank, type Level } from "@/lib/levels";
import { AdminSummary } from "@/components/AdminSummary";
import { ComplianceCard } from "@/components/ComplianceCard";
import { canSeeCompliance } from "@/lib/compliance/model";

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

function quickActions(roles: Parameters<typeof can>[0], t: Dict) {
  const all: { show: boolean; href: string; label: string; icon: IconName }[] = [
    { show: can(roles, "editSales"), href: "/rfqs/new", label: t["qa.rfq"], icon: "plus" },
    { show: can(roles, "editSales"), href: "/quotations/new", label: t["qa.quote"], icon: "doc" },
    { show: can(roles, "editPurchasing"), href: "/purchase-orders/new", label: t["qa.po"], icon: "purchasing" },
    { show: can(roles, "receiveGoods"), href: "/receiving", label: t["qa.receive"], icon: "stock" },
    { show: can(roles, "editDeliveries"), href: "/deliveries/new", label: t["qa.deliver"], icon: "deliveries" },
    { show: can(roles, "editInvoices"), href: "/invoices/new", label: t["qa.invoice"], icon: "doc" },
    { show: can(roles, "editInvoices"), href: "/invoices?tab=unpaid", label: t["qa.payment"], icon: "cash" },
    { show: can(roles, "seeStock"), href: "/stock", label: t["qa.stock"], icon: "stock" },
  ];
  return all.filter((a) => a.show).slice(0, 4);
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, profile, company, roles, isManager, user, features } = await getAppContext();
  // Drivers start on their deliveries; a note (e.g. "your role can't open that screen") goes with them.
  if (onlyRoles(roles, "driver")) redirect(withNotice("/driver", notice));
  const sp = (await searchParams) ?? {};
  const welcomeLevel = typeof sp.welcome === "string" && isLevel(sp.welcome) ? sp.welcome : null;
  const firstName = displayName(profile).split(" ")[0];
  // Check for time-based alerts (at most every 30 minutes; harmless before the Stage 7 update),
  // then the dashboard; everything else on this screen loads at the same time.
  type Pending = { id: string; number: string; revision: number; total: number; currency: string; client: { name: string } | null };
  type PendingPo = { id: string; number: string; total: number; currency: string; supplier: { name: string } | null };
  const level: Level = company.business_level ?? "medium";
  const [{ t }, [dash, overdue], counts, approvals, poApprovals, recs] = await Promise.all([
    getDict(),
    (async () => {
      await supabase.rpc("refresh_alerts", { p_company: company.id });
      const { t: dict } = await getDict();
      return Promise.all([
        loadDashboard(supabase, company.id, roles, dict),
        // Automatic backups: an orange line for managers when the last one is more than 2 days old.
        isManager && !company.is_demo ? backupTowerItem(supabase, company.id) : Promise.resolve(null),
      ]);
    })(),
    isManager
      ? Promise.all([
          supabase.from("memberships").select("id", { count: "exact", head: true }).eq("company_id", company.id),
          supabase.from("invitations").select("id", { count: "exact", head: true }).eq("company_id", company.id),
          supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", company.id),
        ])
      : Promise.resolve(null),
    can(roles, "approveQuotes")
      ? supabase
          .from("quotations")
          .select("id, number, revision, total, currency, submitted_by, client:clients(name)")
          .eq("company_id", company.id)
          .eq("status", "pending_approval")
          .neq("submitted_by", user.id)
          .order("submitted_at")
          .limit(10)
          .then(({ data }) => (data ?? []) as unknown as Pending[])
      : Promise.resolve([] as Pending[]),
    can(roles, "approvePOs")
      ? supabase
          .from("purchase_orders")
          .select("id, number, total, currency, supplier:suppliers(name)")
          .eq("company_id", company.id)
          .eq("status", "pending_approval")
          .neq("submitted_by", user.id)
          .order("submitted_at")
          .limit(10)
          .then(({ data }) => (data ?? []) as unknown as PendingPo[])
      : Promise.resolve([] as PendingPo[]),
    // Growth (Stage 11): recommendations for managers. Quiet before that SQL is run.
    isManager && features.ready && !company.is_demo
      ? (async () => {
          try {
            await supabase.rpc("run_growth_check", { p_company: company.id, p_force: false });
          } catch {
            /* the scheduled check covers it */
          }
          return loadRecommendations(supabase, company.id, features, level);
        })()
      : Promise.resolve(null),
  ]);
  if (overdue) dash.tower.attention.unshift({ ...overdue, label: tr(overdue.label) });
  const actions = quickActions(roles, t);
  const today = new Intl.DateTimeFormat(t.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const base = company.base_currency;

  let checklist: { done: boolean; label: string; href: string }[] = [];
  if (counts) {
    const [{ count: members }, { count: invites }, { count: clientCount }] = counts;
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
  // Grey loading shapes only where the card will most likely appear (it hides itself when the features are off).
  const adminCardLikely = ["hr_people", "hse", "quality", "timesheet_approval"].some((k) => features.on(k));

  const needsOnboarding = isManager && company.onboarding_done === false && !company.is_demo;
  // Stage 12: "Take a 2-minute tour" for managers in the first 14 days after onboarding
  // (until dismissed on this device; without a level date it shows until dismissed).
  const invitedToTour = (() => {
    if (!isManager || company.is_demo || company.onboarding_done === false) return false;
    const since = company.level_changed_at ? Date.parse(company.level_changed_at) : NaN;
    return Number.isFinite(since) ? Date.now() - since < 14 * 864e5 : true;
  })();
  let growth: { featureRecs: number; featureLevel: Level | null; levelRec: Level | null } | null = null;
  if (recs) {
    const featureKeys = recs.list.map((r) => r.feature_key).filter((k): k is string => Boolean(k));
    const levelsOf = new Set(
      features.list.filter((f) => featureKeys.includes(f.key) && levelRank(f.default_level) > levelRank(level)).map((f) => f.default_level),
    );
    const allAbove = featureKeys.every((k) => features.list.some((f) => f.key === k && levelRank(f.default_level) > levelRank(level)));
    const levelRecs = recs.list.map((r) => r.target_level).filter((l): l is Level => Boolean(l));
    growth = {
      featureRecs: featureKeys.length,
      featureLevel: allAbove && levelsOf.size === 1 ? [...levelsOf][0] : null,
      levelRec: levelRecs.sort((a, b) => levelRank(a) - levelRank(b))[0] ?? null,
    };
  }

  // The line under the greeting: only what this person's roles cover, and nothing that is zero.
  const waitingCount = approvals.length + poApprovals.length;
  const summaryParts: { key: string; href: string; text: React.ReactNode }[] = [];
  if (waitingCount > 0) {
    summaryParts.push({
      key: "approvals",
      href: poApprovals.length === 0 ? "/quotations?tab=approval" : approvals.length === 0 ? "/purchase-orders?tab=approval" : "#waiting",
      text: `${waitingCount} ${waitingCount === 1 ? tr("approval waiting") : tr("approvals waiting")}`,
    });
  }
  const dnToday = dash.summary.deliveriesToday ?? 0;
  if (dnToday > 0) {
    summaryParts.push({ key: "deliveries", href: "/deliveries", text: `${dnToday} ${dnToday === 1 ? tr("delivery today") : tr("deliveries today")}` });
  }
  const dueWeek = dash.summary.dueThisWeek ?? 0;
  if (dueWeek > 0) {
    summaryParts.push({
      key: "due",
      href: "/invoices?tab=unpaid",
      text: (
        <>
          <MoneyFig value={dueWeek} currency={base} short /> {tr("due this week")}
        </>
      ),
    });
  }

  // Sections each person can order or hide (Customise). Default order = the order they had before.
  const canApprove = can(roles, "approveQuotes") || can(roles, "approvePOs");
  const sectionMeta: HomeSectionMeta[] = [
    { id: "tower", label: t["home.tower"] },
    ...(features.on("ai_assistant") ? [{ id: "ask", label: "Ask the assistant" }] : []),
    { id: "tips", label: "Tips and suggestions", locked: true },
    ...(canApprove ? [{ id: "approvals", label: t["home.waiting"] }] : []),
    ...(actions.length > 0 ? [{ id: "quick", label: t["home.quickActions"] }] : []),
    { id: "stats", label: "Statistics" },
    ...(isManager && remaining > 0 ? [{ id: "setup", label: t["home.setup"] }] : []),
  ].map((s) => ({ ...s, label: tr(String(s.label ?? "")) }));

  const statSlides = [
    dash.kpis.length > 2 && <HomeKeyFigures key="kpis" currency={base} />,
    dash.months && dash.months.some((m) => m.sales > 0) && (
      <SalesChart key="sales" months={dash.months} currency={base} t={t} drill={can(roles, "seeInvoices")} />
    ),
    dash.aging && <AgingChart key="aging" aging={dash.aging} currency={base} title={t["c.aging"]} />,
    dash.industries && dash.industries.length > 0 && (
      <BarList key="ind" title={t["c.industry"]} sub={t["c.thisYear"]} rows={dash.industries} currency={base} href="/profit" />
    ),
    dash.clients && dash.clients.length > 0 && (
      <BarList key="cli" title={t["c.topClients"]} sub={t["c.thisYear"]} rows={dash.clients} currency={base} href="/profit" />
    ),
  ].filter(Boolean);

  const sectionNodes: HomeSectionNode[] = [
    { id: "tower", overlap: true, node: <ControlTower tower={dash.tower} t={t} /> },
    {
      id: "ask",
      overlap: true,
      node: features.on("ai_assistant") && (
        <form action="/assistant" className="as-home" role="search">
          <span className="as-orb as-orb-sm" aria-hidden="true" />
          <input name="q" maxLength={500} placeholder={tr("Ask the assistant, for example: who owes us money?")} aria-label={tr("Ask the assistant")} />
          <button type="submit" className="btn btn-primary btn-small">
            {tr("Ask")}
          </button>
        </form>
      ),
    },
    {
      id: "tips",
      node: (
        <>
          {needsOnboarding && <OnboardingCard />}
          {isManager && welcomeLevel && <FirstStepsCard level={welcomeLevel} />}
          {invitedToTour && <TourInvite tour={level} company={company.id} />}
          {growth && <GrowthCard level={level} featureRecs={growth.featureRecs} featureLevel={growth.featureLevel} levelRec={growth.levelRec} />}
          {/* These two fetch their own data: the rest of the screen shows without waiting for them. */}
          <Suspense fallback={adminCardLikely ? <SkeletonCard tiles={3} lines={0} /> : null}>
            <AdminSummary />
          </Suspense>
          <Suspense fallback={features.on("compliance") && canSeeCompliance(roles) ? <SkeletonCard lines={2} /> : null}>
            <ComplianceCard />
          </Suspense>
        </>
      ),
    },
    {
      id: "approvals",
      node: (approvals.length > 0 || poApprovals.length > 0) && (
        <section className="card" id="waiting">
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
      ),
    },
    {
      id: "quick",
      node: actions.length > 0 && (
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
      ),
    },
    {
      id: "stats",
      node: statSlides.length > 0 && (
        <section className="stats-block">
          <h2>{tr("Statistics")}</h2>
          <Carousel label={tr("Statistics")}>{statSlides}</Carousel>
        </section>
      ),
    },
    {
      id: "setup",
      node: isManager && remaining > 0 && (
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
      ),
    },
  ];

  return (
    <HomePrefsProvider
      storageKey={layoutKey(company.id, user.id)}
      kpis={dash.kpis.map((k) => ({ ...k, label: tr(String(k.label ?? "")) }))}
      sections={sectionMeta}
      countUp=".hero-kpis .money-amt, .hero-kpis .kpi-val, .stat .money-amt, .stat .kpi-val"
    >
      <section className="hero">
        <div className="hero-top">
          <div className="hero-date">{today}</div>
          <HomeCustomise />
        </div>
        <h1>
          {greeting(t)}, {firstName}
        </h1>
        {summaryParts.length > 0 && (
          <p className="hero-summary">
            {summaryParts.map((s, i) => (
              <span key={s.key}>
                {i > 0 && ", "}
                <Link href={s.href}>{s.text}</Link>
              </span>
            ))}
            .
          </p>
        )}
        <HomeHeroTiles currency={base} />
      </section>
      <HomeFlow notice={<Notice {...notice} />} hasNotice={Boolean(notice.error)} sections={sectionNodes} />
    </HomePrefsProvider>
  );
}
