import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import "../suggestions/suggestions.css";
import "./admin.css";
import { AdminTabs } from "./AdminTabs";
import { platformAdmin } from "./guard";

export const metadata = { title: "LeMo Tech admin" };

/** The admin platform is for LeMo Tech staff only. Everyone else sees a polite page and no data. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) {
    return (
      <div className="card adm-closed">
        <div className="adm-closed-icon" aria-hidden>
          🔒
        </div>
        <h1>{tr("Not available")}</h1>
        <p className="muted">{tr("This area is only for the LeMo Tech platform team.")}</p>
        <p className="small muted">{tr("Platform admins must sign in with two-step verification (Your account → Security).")}</p>
        {admin.missingSql && <p className="small muted">{tr("(The Stage 11 database update has not been run yet.)")}</p>}
        <Link href="/" className="btn btn-primary">
          {tr("Back to the dashboard")}
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="adm-head">
        <span className="adm-kicker">{tr("LeMo Tech")}</span>
        <h1>{tr("Platform admin")}</h1>
      </div>
      <AdminTabs />
      {children}
    </>
  );
}
