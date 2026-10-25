import { primeLang, tr } from "@/lib/tr";
import { brandForCompany } from "@/lib/brands";
import { portalDb, requirePortal } from "@/lib/portal/server";
import { LangSwitch } from "@/components/LangSwitch";
import { signOut } from "../actions";
import { PortalTabs } from "../_c/PortalTabs";

export const dynamic = "force-dynamic";

/** The signed-in portal: our company's logo and colours, the client's or supplier's name, the tabs. */
export default async function PortalFrame({ children }: { children: React.ReactNode }) {
  await primeLang();
  const { me } = await requirePortal();
  const c = me.company;
  const brand = brandForCompany(c.id);
  const db = portalDb();
  const logo = c.logo_path && db ? db.storage.from("branding").getPublicUrl(c.logo_path).data.publicUrl : null;
  const initials = c.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const style = { "--brand": c.primary_color, "--brand-dark": c.accent_color } as React.CSSProperties;
  const n = (k: string) => Number(me.counts[k] ?? 0);
  const tabs =
    me.account.party === "client"
      ? [
          { href: "/portal/home", label: tr("Home") },
          { href: "/portal/quotations", label: tr("Quotations"), count: n("quotations_to_answer") },
          { href: "/portal/orders", label: tr("Orders & deliveries"), count: n("deliveries_on_the_way") },
          { href: "/portal/invoices", label: tr("Invoices"), count: n("overdue_invoices") },
          { href: "/portal/documents", label: tr("Documents") },
          { href: "/portal/messages", label: tr("Messages") },
        ]
      : [
          { href: "/portal/home", label: tr("Home") },
          { href: "/portal/rfqs", label: tr("Requests for prices"), count: n("rfqs_to_answer") },
          { href: "/portal/purchase-orders", label: tr("Purchase orders"), count: n("orders_to_confirm") },
          { href: "/portal/send", label: tr("Invoices & delivery notes") },
          { href: "/portal/company", label: tr("Your company") },
          { href: "/portal/documents", label: tr("Documents") },
          { href: "/portal/messages", label: tr("Messages") },
        ];

  return (
    <div className="portal-shell" style={style}>
      <header className="portal-top">
        <div className="portal-brand">
          {logo ? (
            <img src={logo} alt="" className="portal-logo" />
          ) : brand ? (
            <img src={`/brands/${brand.key}/mark.svg`} alt="" className="portal-logo" />
          ) : (
            <span className="portal-mark" aria-hidden="true">{initials}</span>
          )}
          <span className="portal-who">
            <strong>{c.name}</strong>
            <span>
              {me.account.party === "client" ? tr("Client portal") : tr("Supplier portal")} · {me.account.party_name}
            </span>
          </span>
        </div>
        <div className="portal-top-actions">
          <LangSwitch className="portal-lang" />
          <form action={signOut}>
            <button type="submit" className="btn btn-small">{tr("Sign out")}</button>
          </form>
        </div>
      </header>
      <PortalTabs tabs={tabs} />
      <main className="page portal-page">{children}</main>
      <footer className="portal-foot small muted">
        <LangSwitch className="portal-lang-foot" />
        <span>
          {me.account.name} · {me.account.email}
        </span>
        <span>
          {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a>}
          {c.phone && c.email && " · "}
          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
        </span>
        <span>{tr("Powered by")} LeMoSp</span>
      </footer>
    </div>
  );
}
