import { primeLang, tr } from "@/lib/tr";
import { brandByKey } from "@/lib/brands";
import { LangSwitch } from "@/components/LangSwitch";

/** The sign-in frame of the portal: the company's brand when the link carries it (?b=triumph). */
export async function AuthCard({ brandKey, title, children }: { brandKey?: string | null; title: string; children: React.ReactNode }) {
  await primeLang();
  const brand = brandByKey(brandKey ?? null);
  const style = brand ? ({ "--brand": brand.themeColor } as React.CSSProperties) : undefined;
  return (
    <div className="auth-wrap portal-auth" style={style}>
      <LangSwitch className="auth-lang" />
      {brand ? (
        <img className="auth-logo" src={brand.logoOnDark} alt={brand.name} />
      ) : (
        <p className="portal-auth-word">{tr("Client & supplier portal")}</p>
      )}
      <div className="auth-card">
        <h1 style={{ margin: "0 0 4px" }}>{tr(title)}</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          {brand ? `${brand.name} · ${tr("Client & supplier portal")}` : tr("Quotations, orders, deliveries, invoices and documents in one place.")}
        </p>
        {children}
      </div>
      <p className="auth-foot">{tr("Powered by")} {tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
