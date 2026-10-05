/**
 * LeMoSp ADMIN lives on its own web address (a second Netlify site built from the same code),
 * because a phone treats each web address as a different app. These helpers tell the two apart.
 *
 * Safe to import anywhere: middleware, server code and client components (only NEXT_PUBLIC_ values).
 *
 * An address is the admin app when it is
 *   - the address in NEXT_PUBLIC_ADMIN_URL, or
 *   - starts with "admin." (e.g. admin.lemosp.co.tz, admin.localhost), or
 *   - its first label ends with "-admin" (e.g. lemosp-admin.netlify.app,
 *     and Netlify's previews of that site such as deploy-preview-3--lemosp-admin.netlify.app).
 */

/** "LeMoSp-Admin.Netlify.app:443" → "lemosp-admin.netlify.app"; "[::1]:3000" → "::1". */
export function normalizeHost(host: string | null | undefined): string {
  let h = (host ?? "").split(",")[0].trim().toLowerCase();
  if (h.includes("://")) h = h.slice(h.indexOf("://") + 3);
  h = h.split("/")[0];
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    h = end > 0 ? h.slice(1, end) : h.slice(1);
  } else if ((h.match(/:/g) ?? []).length === 1) {
    h = h.slice(0, h.indexOf(":"));
  }
  return h.replace(/\.$/, "");
}

/** The host part of a web address ("https://x.netlify.app/" → "x.netlify.app"), or "" when empty. */
export function hostOfUrl(url: string | null | undefined): string {
  return url && url.trim() ? normalizeHost(url) : "";
}

const cleanUrl = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

/** The LeMoSp ADMIN address (NEXT_PUBLIC_ADMIN_URL), without a trailing slash; null when not set up. */
export function adminUrl(env: string | undefined = process.env.NEXT_PUBLIC_ADMIN_URL): string | null {
  return cleanUrl(env);
}

/**
 * The company app's address (NEXT_PUBLIC_MAIN_URL, else NEXT_PUBLIC_SITE_URL); null when neither is
 * set. An admin address is never returned (on the admin site NEXT_PUBLIC_SITE_URL is the admin
 * address, and linking "Open company app" there would just come back to the admin app).
 */
export function mainUrl(
  main: string | undefined = process.env.NEXT_PUBLIC_MAIN_URL,
  site: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  adminEnv: string | undefined = process.env.NEXT_PUBLIC_ADMIN_URL,
): string | null {
  for (const candidate of [cleanUrl(main), cleanUrl(site)]) {
    if (candidate && !isAdminHost(hostOfUrl(candidate), adminEnv)) return candidate;
  }
  return null;
}

export function isAdminHost(host: string | null | undefined, adminEnv: string | undefined = process.env.NEXT_PUBLIC_ADMIN_URL): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  const configured = hostOfUrl(adminEnv);
  if (configured && h === configured) return true;
  if (h.startsWith("admin.")) return true;
  const first = h.split(".")[0];
  return first.endsWith("-admin");
}

/** Paths the admin address serves. Everything else there is company app and goes to /admin. */
export function allowedOnAdminHost(path: string): boolean {
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  return (
    under("/admin") ||
    under("/login") ||
    under("/auth") ||
    under("/forgot-password") ||
    under("/two-step") ||
    under("/delete-account") ||
    path === "/api/version" ||
    path === "/manifest.webmanifest" ||
    path === "/api/app-manifest" ||
    path === "/sw.js" ||
    path === "/favicon.ico" ||
    path === "/favicon.svg" ||
    under("/icons") ||
    under("/brand") ||
    under("/_next")
  );
}
