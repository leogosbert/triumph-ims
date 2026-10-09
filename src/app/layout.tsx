import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { getLang } from "@/lib/lang";
import { LangProvider } from "@/lib/tr-client";
import { getThemePref, THEME_SCRIPT } from "@/lib/theme";
import { Splash, SPLASH_SCRIPT } from "@/components/Splash";
import { NavProgress } from "@/components/NavProgress";
import { InstallPrompt } from "@/components/InstallPrompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { onAdminHost } from "@/lib/hosts-server";
import { AdminHostProvider } from "@/lib/host-client";
import "./globals.css";
import "./look.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono", display: "swap" });

/**
 * One code base, two apps: the company app "LeMoSp", and "LeMoSp ADMIN" on its own address
 * (src/lib/hosts.ts). /manifest.webmanifest answers per address too; iPhones take the
 * home-screen name from appleWebApp.title.
 */
export async function generateMetadata(): Promise<Metadata> {
  const name = (await onAdminHost()) ? "LeMoSp ADMIN" : "LeMoSp";
  return {
    title: { default: name, template: `%s · ${name}` },
    description: "LeMoSp, a LeMo Tech Solutions product — sales, procurement, stock, delivery and finance for general supply companies.",
    applicationName: name,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-48.png", sizes: "48x48" }],
      apple: "/icons/icon-180.png",
    },
    appleWebApp: { capable: true, title: name, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0B1F3A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const theme = await getThemePref();
  const adminHost = await onAdminHost();
  return (
    <html
      lang={lang}
      data-app={adminHost ? "admin" : undefined}
      className={`${sans.variable} ${mono.variable}`}
      data-theme-pref={theme}
      data-theme={theme === "auto" ? undefined : theme}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + SPLASH_SCRIPT }} />
      </head>
      <body>
        <Splash />
        <NavProgress />
        <LangProvider lang={lang === "sw" ? "sw" : "en"}>
          <AdminHostProvider admin={adminHost}>
            {children}
            {/* On the admin address LeMoSp ADMIN is the only app, so its card shows on every page. */}
            <InstallPrompt variant={adminHost ? "admin" : "main"} />
            <UpdatePrompt lang={lang === "sw" ? "sw" : "en"} />
          </AdminHostProvider>
        </LangProvider>
      </body>
    </html>
  );
}
