import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** The Supabase project's address, read when the app is built (falls back to any Supabase project). */
function supabaseOrigins(): { https: string; wss: string } {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") {
      return { https: u.origin, wss: `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}` };
    }
  } catch {
    /* not set: use the fallback */
  }
  return { https: "https://*.supabase.co", wss: "wss://*.supabase.co" };
}

const sb = supabaseOrigins();

/**
 * Content-Security-Policy: the browser only runs code and loads data from this site and from Supabase.
 * Next.js 15 needs 'unsafe-inline' for its own start-up scripts (and the theme/splash script in the layout)
 * unless every page gets a nonce; 'unsafe-eval' is only needed by the development server.
 * Outside services used from the browser: Supabase (data, sign-in, logo images) and
 * api.pwnedpasswords.com (leaked-password check). Push, email (Resend) and PDFs run on the server.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${sb.https}`,
  "font-src 'self' data:",
  `connect-src 'self' ${sb.https} ${sb.wss} https://api.pwnedpasswords.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const common = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  // Always https for two years (not "preload": that is hard to undo).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Each deployment gets its own id so open apps can tell when a newer version is live.
  env: {
    NEXT_PUBLIC_BUILD_ID: (process.env.COMMIT_REF || process.env.GITHUB_SHA || `local-${Date.now()}`).slice(0, 12),
  },
  // One code base, two apps: the install details depend on the web address (src/app/api/app-manifest).
  async rewrites() {
    return { beforeFiles: [{ source: "/manifest.webmanifest", destination: "/api/app-manifest" }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      { source: "/:path*", headers: common },
      // Pages and data: the content policy. Not on the PDF documents (…/pdf), which the
      // phone's built-in PDF viewer opens and which a strict policy can stop it showing.
      { source: "/", headers: [{ key: "Content-Security-Policy", value: csp }] },
      { source: "/:path((?!.*/pdf$).+)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
