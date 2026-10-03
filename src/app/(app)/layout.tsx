import { BottomNav } from "@/components/BottomNav";
import { brandingUrl, getAppContext } from "@/lib/context";
import { ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, company, role, user } = await getAppContext();
  // Unread notifications (0 until the Stage 7 database update has been run).
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  const logo = brandingUrl(supabase, company.logo_path);
  const initials = company.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const brandStyle = {
    "--brand": company.primary_color,
    "--brand-dark": company.accent_color,
  } as React.CSSProperties;

  return (
    <div className="shell" style={brandStyle}>
      <header className="topbar">
        {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
        <div className="who">
          <strong>{company.name}</strong>
          <span>{ROLE_LABELS[role]}</span>
        </div>
        <a href="/notifications" className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {(unread ?? 0) > 0 && <span className="count">{(unread ?? 0) > 99 ? "99+" : unread}</span>}
        </a>
      </header>
      <main className="page">{children}</main>
      <BottomNav role={role} />
    </div>
  );
}
