import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LangProvider } from "@/lib/tr-client";
import { getThemePref, THEME_SCRIPT } from "@/lib/theme";
import { LOOK_SCRIPT } from "@/lib/look";
import { getLookPref } from "@/lib/look-server";
import { Splash, SPLASH_SCRIPT } from "@/components/Splash";
import { GlassSplash } from "@/components/GlassSplash";
import { NavProgress } from "@/components/NavProgress";
import { SubmitterValue } from "@/components/SubmitterValue";
import { InstallPrompt } from "@/components/InstallPrompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { onAdminHost } from "@/lib/hosts-server";
import { getBrand } from "@/lib/brand-server";
import { AdminHostProvider } from "@/lib/host-client";
import { DemoBridge } from "@/demoBridge/DemoBridge";
import { demoConfig } from "@/demoBridge/demoConfig";
import "./globals.css";
import "./look.css";
import "./billing.css";
import "./services.css";
import "./polish.css";
import "./glass.css";
import "./my.css";
import "./nav.css";

// IBM Plex is bundled in src/app/fonts (SIL Open Font License), so builds never depend on downloading Google Fonts.
const sans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

/**
 * One code base, two apps: the company app "LeMoSp", and "LeMoSp ADMIN" on its own address
 * (src/lib/hosts.ts). /manifest.webmanifest answers per address too; iPhones take the
 * home-screen name from appleWebApp.title.
 */
export async function generateMetadata(): Promise<Metadata> {
  const admin = await onAdminHost();
  // A company with its own brand (src/lib/brands.ts) installs under its own name and icon.
  const brand = admin ? null : await getBrand();
  if (brand) {
    const dir = `/brands/${brand.key}`;
    return {
      title: { default: brand.shortName, template: `%s · ${brand.shortName}` },
      description: brand.description,
      applicationName: brand.shortName,
      manifest: `/manifest.webmanifest?brand=${brand.key}`,
      icons: {
        icon: [{ url: `${dir}/favicon-48.png`, sizes: "48x48" }, { url: `${dir}/icon-192.png`, sizes: "192x192" }],
        apple: `${dir}/icon-180.png`,
      },
      appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "black-translucent" },
    };
  }
  const name = admin ? "LeMoSp ADMIN" : "LeMoSp";
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
  const theme = await getThemePref();
  const adminHost = await onAdminHost();
  // Glass or Classic (Account → Appearance → Style). LeMoSp ADMIN keeps its own look.
  const look = adminHost ? "classic" : await getLookPref();
  // A company brand remembered on this device opens with its own launch (the company app shell
  // brings its own copy with the company logo, which then takes over: glass.css).
  const brand = adminHost ? null : await getBrand();
  return (
    <html
      lang="en"
      data-app={adminHost ? "admin" : undefined}
      data-look={look}
      className={`${sans.variable} ${mono.variable}`}
      data-theme-pref={theme}
      data-theme={theme === "auto" ? undefined : theme}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + SPLASH_SCRIPT + LOOK_SCRIPT }} />
      </head>
      <body>
        <Splash />
        {brand && (
          <GlassSplash
            brand={brand.key}
            logo={`/brands/${brand.key}/mark.svg`}
            name={brand.shortName}
            tagline="Powered by LeMoSp · LeMo Tech Solutions"
          />
        )}
        <NavProgress />
        <SubmitterValue />
        <LangProvider>
          <AdminHostProvider admin={adminHost}>
            {children}
            {/* On the admin address LeMoSp ADMIN is the only app, so its card shows on every page. */}
            <InstallPrompt variant={adminHost ? "admin" : "main"} />
            <UpdatePrompt />
            {demoConfig.enabled && <DemoBridge />}
          </AdminHostProvider>
        </LangProvider>
      </body>
    </html>
  );
}
