import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TRIUMPH IMS", template: "%s · TRIUMPH IMS" },
  description: "Supply, procurement, stock, delivery and finance in one app.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-180.png",
  },
  appleWebApp: { capable: true, title: "TRIUMPH IMS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#123A7A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
