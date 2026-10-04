import type { Metadata } from "next";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { InstallPrompt } from "@/components/InstallPrompt";
import "../suggestions/suggestions.css";
import "./admin.css";
import { AdminBottomNav, AdminTabs } from "./AdminTabs";
import { platformAdmin } from "./guard";

/**
 * Verified admins get the "LeMoSp ADMIN" app: its own manifest (so a phone installs it as a
 * second app, separate from the company app), name and home-screen title. Everyone else keeps
 * the company app's metadata.
 *
 * The manifest lives under /icons/ because the sign-in middleware lets that folder through:
 * browsers fetch manifests without cookies, so any other path would be redirected to /login.
 */
export async function generateMetadata(): Promise<Metadata> {
  const admin = await platformAdmin();
  if (!admin.ok) return { title: "LeMo Tech admin" };
  return {
    title: { absolute: "LeMoSp ADMIN", template: "%s · LeMoSp ADMIN" },
    applicationName: "LeMoSp ADMIN",
    manifest: "/icons/admin-app.webmanifest",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-48.png", sizes: "48x48" }],
      apple: "/icons/icon-180.png",
    },
    appleWebApp: { capable: true, title: "LeMoSp ADMIN", statusBarStyle: "black-translucent" },
  };
}

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
    // .adm-shell switches the page into the "LeMoSp ADMIN" app: admin.css hides the company
    // app's top bar, sidebar and bottom bar while it is on the page.
    <div className="adm-shell">
      <header className="adm-bar">
        <Link href="/admin" className="adm-brand" aria-label="LeMoSp ADMIN">
          <img src="/brand/lemosp-admin-bar.svg" alt="LeMoSp ADMIN" width={358} height={72} />
        </Link>
        <div className="adm-who">
          <span className="adm-name" title={admin.name}>
            {admin.name}
          </span>
          <a href="/" className="adm-exit">
            {tr("Open company app")}
          </a>
        </div>
      </header>
      <div className="adm-head">
        <span className="adm-kicker">{tr("LeMo Tech")}</span>
        <h1>{tr("Platform admin")}</h1>
      </div>
      <AdminTabs />
      {children}
      <AdminBottomNav />
      <InstallPrompt variant="admin" />
    </div>
  );
}
