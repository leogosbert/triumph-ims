import { isAdminHost } from "@/lib/hosts";

/**
 * The install details ("web app manifest") for whichever app this address is:
 * the company app "LeMoSp", or "LeMoSp ADMIN" on the admin address (see src/lib/hosts.ts).
 * A phone treats each web address as a separate app, so both use id "/" and scope "/".
 *
 * Served at /manifest.webmanifest through a rewrite in next.config.ts (a route folder named
 * "manifest.webmanifest" would collide with Next's own manifest file convention). Browsers fetch
 * it without sign-in cookies; the middleware never sees /manifest.webmanifest (see its matcher)
 * and lets /api/app-manifest through too.
 */
export const dynamic = "force-dynamic";

const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const COMMON = {
  id: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0B1F3A",
  theme_color: "#0B1F3A",
  icons: ICONS,
};

const MAIN = {
  ...COMMON,
  name: "LeMoSp",
  short_name: "LeMoSp",
  description: "Sales, procurement, stock, delivery and finance for general supply companies — by LeMo Tech Solutions.",
  start_url: "/",
};

const ADMIN = {
  ...COMMON,
  name: "LeMoSp ADMIN",
  short_name: "LeMoSp ADMIN",
  description: "LeMoSp platform admin for the LeMo Tech team — companies, features, growth rules and feedback.",
  start_url: "/admin",
};

export function GET(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const body = isAdminHost(host) ? ADMIN : MAIN;
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Short cache: changes reach phones quickly; Vary because one code base serves two addresses.
      "Cache-Control": "public, max-age=300, must-revalidate",
      Vary: "Host, X-Forwarded-Host",
    },
  });
}
