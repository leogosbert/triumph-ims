import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { BottomNav, SideNav } from "@/components/BottomNav";
import { NavPills } from "@/components/NavPills";
import { CompanyButton, CompanySheet, type CompanyCard } from "@/components/CompanySheet";
import { CompanyClosing } from "@/components/CompanyClosing";
import { ClosingGate } from "@/components/ClosingGate";
import { AppLock } from "@/components/AppLock";
import { DemoBar } from "@/components/DemoBar";
import { IdleGuard } from "@/components/IdleGuard";
import { PrivacyScreen } from "@/components/PrivacyScreen";
import { TourHost } from "@/components/tour/TourHost";
import { Icon } from "@/components/Icon";
import { getThemePref } from "@/lib/theme";
import { getBackgroundPref } from "@/lib/background";
import { AppBackground } from "@/components/AppBackground";
import { getLookPref } from "@/lib/look-server";
import { GlassSplash } from "@/components/GlassSplash";
import { BrandCookie } from "@/components/BrandCookie";
import { AskBox } from "@/components/ai/AskBox";
import { brandForCompany } from "@/lib/brands";
import { SectionTracker } from "@/components/SectionTracker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { brandingUrl, getAppContext } from "@/lib/context";
import type { Key } from "@/lib/i18n";
import { getDict } from "@/lib/lang";
import { defaultCategory, moreMenu } from "@/lib/menu";
import { bottomNav, sideNav } from "@/lib/nav";
import { setLanguage } from "../lang-actions";
import { onAdminHost } from "@/lib/hosts-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await primeLang();
  // LeMoSp ADMIN address: only the admin screens are served there (middleware), and they bring
  // their own header and bottom bar. No company shell, no company data, no company needed.
  if (await onAdminHost()) {
    return (
      <div className="shell adm-host">
        <div className="main-col">
          <main className="page">{children}</main>
        </div>
      </div>
    );
  }
  const { supabase, company, role, user, isManager, profile, memberships, features, isPlatformAdmin } = await getAppContext();
  // Everything else the frame needs, at the same time.
  const [{ lang, t }, { count: unread }, theme, background, look] = await Promise.all([
    getDict(),
    // Unread notifications (0 until the Stage 7 database update has been run).
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    getThemePref(),
    getBackgroundPref(),
    getLookPref(),
  ]);
  const logo = brandingUrl(supabase, company.logo_path);
  const initials = company.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  // The company is closing (Settings → Company details → Close company account): only this screen.
  // (The LeMoSp ADMIN pages are let through: ClosingGate.)
  if (company.closing_after) {
    return (
      <ClosingGate
        closing={
          <CompanyClosing
            supabase={supabase}
            company={company}
            isManager={isManager}
            others={memberships.filter((m) => m.company_id !== company.id)}
            logo={logo}
            initials={initials}
          />
        }
      >
        <div className="shell adm-host">
          <div className="main-col">
            <main className="page">{children}</main>
          </div>
        </div>
      </ClosingGate>
    );
  }

  const card: CompanyCard = {
    name: company.name,
    logo,
    initials,
    role: t[`role.${role}` as Key],
    details: [
      { label: "TIN", value: company.tin },
      { label: "VRN", value: company.vrn },
      { label: "Phone", value: company.phone },
      { label: "Email", value: company.email },
      { label: "Address", value: company.address },
    ].filter((d): d is { label: string; value: string } => Boolean(d.value)),
    person: { name: profile.full_name ?? "", email: profile.email ?? user.email ?? "" },
    isManager,
    others: memberships
      .filter((m) => m.company_id !== company.id)
      .map((m) => ({ id: m.company_id, name: m.company.name, role: t[`role.${m.role}` as Key] })),
    lang: lang === "sw" ? "sw" : "en",
    theme,
  };

  const personName = profile.full_name || profile.email || user.email || "";
  const personInitials =
    personName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const brandStyle = {
    "--brand": company.primary_color,
    "--brand-dark": company.accent_color,
  } as React.CSSProperties;

  return (
    <div className="shell" style={brandStyle}>
      <AppBackground kind={background} />
      {look === "glass" && (
        <>
          <SectionTracker />
          <GlassSplash logo={logo} name={company.name} tagline={`${t["shell.poweredBy"]} LeMoSp`} />
        </>
      )}
      <SideNav look={look} items={sideNav(role, t, features.on, features.ready && features.list.some((f) => f.key === "service_jobs" && f.enabled), features.ready && features.list.some((f) => (f.key === "hr_people" || f.key === "hse") && f.enabled), isManager)} company={company.name} logo={logo} initials={initials} poweredBy={t["shell.poweredBy"]} />
      <div className="main-col">
        <header className="topbar">
          <CompanyButton className="topbar-brand" title={company.name}>
            {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
            <span className="who">
              <strong>{company.name}</strong>
              <span>{t[`role.${role}` as Key]}</span>
            </span>
          </CompanyButton>
          <AskBox className="topbar-search" placeholder={t["shell.searchPlaceholder"]} />
          <div className="topbar-actions">
            <Link href="/search" className="icon-btn only-phone" aria-label={t["shell.search"]}>
              <Icon name="search" />
            </Link>
            <form action={setLanguage}>
              <input type="hidden" name="lang" value={lang === "en" ? "sw" : "en"} />
              <button type="submit" className="lang-btn" aria-label={t["shell.language"]}>
                <span aria-current={lang === "en" ? "true" : undefined}>{tr("EN")}</span>·<span aria-current={lang === "sw" ? "true" : undefined}>{tr("SW")}</span>
              </button>
            </form>
            {look === "glass" && <ThemeToggle />}
            {isManager && (
              <Link href="/settings" className="icon-btn only-phone" aria-label={t["nav.settings"]}>
                <Icon name="settings" />
              </Link>
            )}
            <Link href="/notifications" className="icon-btn bell" aria-label={`${t["shell.notifications"]}${unread ? `, ${unread} ${t["shell.unread"]}` : ""}`}>
              <Icon name="bell" size={23} />
              {(unread ?? 0) > 0 && <span className="count">{(unread ?? 0) > 99 ? "99+" : unread}</span>}
            </Link>
            {/* Laptops: who is signed in; opens the same company sheet as the logo. */}
            <CompanyButton className="topbar-user" title={personName}>
              <span className="avatar" aria-hidden="true">{personInitials}</span>
              <span className="who">
                <strong>{profile.full_name || tr("Your account")}</strong>
                <span>{t[`role.${role}` as Key]}</span>
              </span>
            </CompanyButton>
          </div>
        </header>
        {company.is_demo && (
          <DemoBar
            role={role}
            level={company.business_level ?? null}
            hoursLeft={Math.max(1, Math.ceil((Date.parse(company.demo_expires_at ?? "") - Date.now()) / 36e5) || 48)}
          />
        )}
        <main className="page">{children}</main>
      </div>
      <CompanySheet card={card} />
      <BrandCookie brand={company.is_demo ? null : (brandForCompany(company.id)?.key ?? null)} />
      <IdleGuard minutes={company.idle_timeout_minutes ?? 0} />
      <PrivacyScreen />
      <AppLock
        email={profile.email ?? user.email ?? ""}
        name={profile.full_name ?? ""}
        logo={logo}
        initials={initials}
        lastSignIn={user.last_sign_in_at ?? null}
        enabled={!user.is_anonymous && Boolean(profile.email ?? user.email)}
      />
      <NavPills />
      <BottomNav
        items={bottomNav(role, t, features.on)}
        menu={moreMenu(role, isManager, { on: features.on, isPlatformAdmin, features: features.list, menu: true })}
        menuStart={defaultCategory(role)}
      />
      <TourHost
        off={features.ready ? features.list.filter((f) => !features.on(f.key)).map((f) => f.key) : []}
        role={role}
        level={company.business_level ?? "medium"}
        company={company.id}
        demo={Boolean(company.is_demo)}
      />
    </div>
  );
}
