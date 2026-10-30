// Demo mode: lets the LeMo Demonstrator (in the LeMo Command Center) drive this app inside an <iframe> on its "big
// table". Off unless the build sets NEXT_PUBLIC_DEMO_BRIDGE=1, refused on the live site (NEXT_PUBLIC_APP_ENV=production),
// and it only listens to parent pages whose origin is listed in NEXT_PUBLIC_DEMO_PARENT_ORIGINS. See docs/DEMO-BRIDGE.md.
// No imports, so the Supabase clients and next.config can read it.

export type DemoEnv = { flag?: string; appEnv?: string; parentOrigins?: string };

export type DemoConfig = { enabled: true; origins: string[] } | { enabled: false; reason: "off" | "production" | "no-origins" };

/** One origin: scheme, host and optional port; no path, no wildcard. */
export function isValidOrigin(o: string): boolean {
  if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)) return false;
  try {
    return new URL(o).origin === o.toLowerCase();
  } catch {
    return false;
  }
}

/** Comma or space separated list; anything that is not an exact origin (including "*") is dropped. */
export function parseOrigins(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter(isValidOrigin)
        .map((s) => s.toLowerCase()),
    ),
  ];
}

export function demoConfigFrom(env: DemoEnv): DemoConfig {
  if (env.flag !== "1") return { enabled: false, reason: "off" };
  if ((env.appEnv ?? "development").toLowerCase() === "production") return { enabled: false, reason: "production" };
  const origins = parseOrigins(env.parentOrigins);
  if (!origins.length) return { enabled: false, reason: "no-origins" };
  return { enabled: true, origins };
}

/** Next.js writes NEXT_PUBLIC_ values into the build, so a normal build never turns demo mode on. */
export const demoConfig: DemoConfig = demoConfigFrom({
  flag: process.env.NEXT_PUBLIC_DEMO_BRIDGE,
  appEnv: process.env.NEXT_PUBLIC_APP_ENV,
  parentOrigins: process.env.NEXT_PUBLIC_DEMO_PARENT_ORIGINS,
});

// ---- Seats ----------------------------------------------------------------------------------------------------
// LeMoSp keeps the sign-in in a cookie, and one browser shares a cookie between every frame of one web address. So each
// seat of the table opens the app at its own address: a Netlify deploy alias on the demo site
// (https://<seat>--<site>.netlify.app), or http://<seat>.localhost:<port> on a computer. The seat is read from it.

export const isValidSeat = (s: string | null | undefined): s is string => !!s && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);

/** The seat an address belongs to ("sales" for sales--lemosp-demo.netlify.app or sales.localhost), else null. */
export function seatFromHost(host: string | null | undefined): string | null {
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const alias = /^([a-z0-9-]+?)--[a-z0-9-]+\.netlify\.app$/.exec(h);
  const local = /^([a-z0-9-]+)\.localhost$/.exec(h);
  const seat = alias?.[1] ?? local?.[1] ?? null;
  return isValidSeat(seat) ? seat : null;
}

/**
 * Cookie settings for the sign-in in demo mode. The table frames this app from another site, and browsers only send a
 * framed site its cookies when they are SameSite=None and Secure; Partitioned keeps them to this table only.
 * Undefined outside demo mode, so the normal settings apply.
 */
export function demoCookieOptions(cfg: DemoConfig = demoConfig) {
  return cfg.enabled ? { sameSite: "none" as const, secure: true, partitioned: true } : undefined;
}

/**
 * Who may show this app in a frame: nobody normally ("'none'"), the Command Center's exact addresses in demo mode. Used
 * by next.config.ts for the frame-ancestors rule; X-Frame-Options is left out whenever framing is allowed.
 */
export function frameAncestors(cfg: DemoConfig = demoConfig): string {
  return cfg.enabled ? cfg.origins.join(" ") : "'none'";
}
