import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { BottomNav, SideNav } from "@/components/BottomNav";
import { Icon } from "@/components/Icon";
import { brandingUrl, getAppContext } from "@/lib/context";
import type { Key } from "@/lib/i18n";
import { getDict } from "@/lib/lang";
import { bottomNav, sideNav } from "@/lib/nav";
import { setLanguage } from "../lang-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await primeLang();
  const { supabase, company, role, user } = await getAppContext();
  const { lang, t } = await getDict();
  const logo = brandingUrl(supabase, company.logo_path);
  const initials = company.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  // Unread notifications (0 until the Stage 7 database update has been run).
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  const brandStyle = {
    "--brand": company.primary_color,
    "--brand-dark": company.accent_color,
  } as React.CSSProperties;

  return (
    <div className="shell" style={brandStyle}>
      <SideNav items={sideNav(role, t)} company={company.name} logo={logo} initials={initials} poweredBy={t["shell.poweredBy"]} />
      <div className="main-col">
        <header className="topbar">
          <Link href="/" className="topbar-brand" aria-label={company.name}>
            {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
            <span className="who">
              <strong>{company.name}</strong>
              <span>{t[`role.${role}` as Key]}</span>
            </span>
          </Link>
          <form action="/search" className="topbar-search" role="search">
            <Icon name="search" size={18} />
            <input type="search" name="q" placeholder={t["shell.searchPlaceholder"]} aria-label={t["shell.search"]} />
          </form>
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
            <a href="/notifications" className="icon-btn bell" aria-label={`${t["shell.notifications"]}${unread ? `, ${unread} ${t["shell.unread"]}` : ""}`}>
              <Icon name="bell" size={23} />
              {(unread ?? 0) > 0 && <span className="count">{(unread ?? 0) > 99 ? "99+" : unread}</span>}
            </a>
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
      <BottomNav items={bottomNav(role, t)} />
    </div>
  );
}
