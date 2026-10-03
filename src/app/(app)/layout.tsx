import { BottomNav } from "@/components/BottomNav";
import { brandingUrl, getAppContext } from "@/lib/context";
import { can, ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, company, role } = await getAppContext();
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
      </header>
      <main className="page">{children}</main>
      <BottomNav showSales={can(role, "seeSales")} showPurchasing={can(role, "seePurchasing")} />
    </div>
  );
}
