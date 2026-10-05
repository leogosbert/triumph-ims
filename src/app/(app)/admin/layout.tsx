import type { Metadata } from "next";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { InstallPrompt } from "@/components/InstallPrompt";
import { mainUrl } from "@/lib/hosts";
import { onAdminHost } from "@/lib/hosts-server";
import "../suggestions/suggestions.css";
import "./admin.css";
import { AdminBottomNav, AdminTabs } from "./AdminTabs";
import { platformAdmin } from "./guard";

/**
 * LeMoSp ADMIN normally runs on its own web address (src/lib/hosts.ts): there the root layout
 * already gives every page the admin name and manifest, so nothing is overridden here.
 *
 * Fallback while the admin address is not set up (/admin inside the company app's address):
 * verified admins get the old per-page admin manifest, name and home-screen title.
 * That manifest lives under /icons/ because the sign-in middleware lets that folder through:
 * browsers fetch manifests without cookies, so any other path would be redirected to /login.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (await onAdminHost()) return {};
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
  const [admin, adminHost] = await Promise.all([platformAdmin(), onAdminHost()]);
  // On the admin address the company app is another site: link to it in full (null when unknown).
  const companyApp = adminHost ? mainUrl() : "/";

  if (!admin.ok) {
    if (adminHost) {
      return (
        <div className="card adm-closed">
          <img className="adm-closed-logo" src="/brand/lemosp-admin-on-dark.svg" alt="LeMoSp ADMIN" width={240} height={82} />
          <h1>{tr("This app is for the LeMoSp platform team")}</h1>
          <p className="muted">{tr("Your account is not a platform admin. To work with your company, open the LeMoSp company app.")}</p>
          <p className="small muted">{tr("Platform admins must sign in with two-step verification.")}</p>
          {admin.missingSql && <p className="small muted">{tr("(The Stage 11 database update has not been run yet.)")}</p>}
          <div className="adm-closed-actions">
            {companyApp && (
              <a href={companyApp} className="btn btn-primary">
                {tr("Open the company app")}
              </a>
            )}
            <Link href="/two-step" className="btn">
              {tr("Two-step verification")}
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn">
                {tr("Sign out")}
              </button>
            </form>
          </div>
        </div>
      );
    }
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
  // Admin notifications bell (0 until the platform notifications database update has been run).
  const { data: unreadData } = await admin.supabase.rpc("platform_unread_count");
  const unread = typeof unreadData === "number" ? unreadData : 0;
  return (
    // .adm-shell switches the page into the "LeMoSp ADMIN" app: admin.css hides the company
    // app's top bar, sidebar and bottom bar while it is on the page (on the admin address the
    // company shell is not rendered at all).
    <div className="adm-shell">
      <header className="adm-bar">
        <Link href="/admin" className="adm-brand" aria-label="LeMoSp ADMIN">
          <img src="/brand/lemosp-admin-bar.svg" alt="LeMoSp ADMIN" width={358} height={72} />
        </Link>
        <div className="adm-who">
          <span className="adm-name" title={admin.name}>
            {admin.name}
          </span>
          <span className="adm-links">
            {companyApp && (
              <a href={companyApp} className="adm-exit" {...(adminHost ? { target: "_blank", rel: "noopener" } : {})}>
                {tr("Open company app")}
              </a>
            )}
            {adminHost && (
              <form action={signOut} className="adm-signout">
                <button type="submit" className="adm-exit">
                  {tr("Sign out")}
                </button>
              </form>
            )}
          </span>
        </div>
        <Link
          href="/admin/notifications"
          className="icon-btn bell adm-bell"
          aria-label={unread ? `${tr("Notifications")}, ${unread} ${tr("unread")}` : tr("Notifications")}
        >
          <Icon name="bell" size={23} />
          {unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
        </Link>
      </header>
      <div className="adm-head">
        <span className="adm-kicker">{tr("LeMo Tech")}</span>
        <h1>{tr("Platform admin")}</h1>
      </div>
      <AdminTabs />
      {children}
      <AdminBottomNav />
      {/* On the admin address the root layout shows the card on every page. */}
      {!adminHost && <InstallPrompt variant="admin" ownAddressHint />}
    </div>
  );
}
