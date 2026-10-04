import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { getLang } from "@/lib/lang";
import { LangProvider } from "@/lib/tr-client";
import { getThemePref, THEME_SCRIPT } from "@/lib/theme";
import { Splash, SPLASH_SCRIPT } from "@/components/Splash";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LeMo Suppliers Manager", template: "%s · LeMo Suppliers Manager" },
  description: "LeMo Suppliers Manager, a LeMo Tech Solutions product — sales, procurement, stock, delivery and finance for general supply companies.",
  applicationName: "LeMo Suppliers Manager",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-48.png", sizes: "48x48" }],
    apple: "/icons/icon-180.png",
  },
  appleWebApp: { capable: true, title: "LeMo Suppliers", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0B1F3A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const theme = await getThemePref();
  return (
    <html
      lang={lang}
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
        <LangProvider lang={lang === "sw" ? "sw" : "en"}>{children}</LangProvider>
      </body>
    </html>
  );
}
