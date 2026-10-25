import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { adminUrl, allowedOnAdminHost, isAdminHost } from "@/lib/hosts";

// /api/outbox is called by the scheduled job and checks its own secret.
// /api/app-manifest is the install details (served as /manifest.webmanifest), fetched without cookies.
// /delete-account explains how to delete an account; app stores require it to open without signing in.
// /how-it-works, /pricing and the /playbooks list teach the app, also to visitors before they sign up
// (a playbook itself opens only for companies LeMo Tech has given it to).
// /api/v1 is the data API for other systems; each call carries its own API key (see /integrations).
// /api/inbound receives email and WhatsApp webhooks; each request carries the provider's signature.
const PUBLIC_PATHS = ["/how-it-works", "/playbooks", "/pricing", "/api/v1", "/login", "/auth", "/forgot-password", "/api/outbox", "/api/inbound", "/api/version", "/api/app-manifest", "/delete-account"];

/**
 * Keeps the sign-in session fresh and sends signed-out visitors to /login.
 * Also keeps the two apps apart (src/lib/hosts.ts): the LeMoSp ADMIN address only serves the
 * admin screens, and the company app sends /admin to the admin address once it is set up.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const adminHost = isAdminHost(host);

  // Scheduled jobs run only on the company app's address, never twice.
  if (adminHost && (path === "/api/outbox" || path.startsWith("/api/outbox/"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Company app: the admin screens live on their own address (once NEXT_PUBLIC_ADMIN_URL is set).
  // Without it, /admin keeps working here as before.
  const admin = adminUrl();
  if (!adminHost && admin && (path === "/admin" || path.startsWith("/admin/"))) {
    return NextResponse.redirect(`${admin}${path}${request.nextUrl.search}`, 307);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Reads the signed session token (and refreshes it when it has expired) without asking
  // Supabase Auth over the network on every tap; see src/lib/supabase/user.ts.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;

  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  const go = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const res = NextResponse.redirect(url);
    // Keep any refreshed sign-in cookies.
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  // LeMoSp ADMIN address: its home is the admin overview, and company screens are not served here.
  if (adminHost && (path === "/" || !allowedOnAdminHost(path))) {
    return go(user ? "/admin" : "/login");
  }

  if (!user && !isPublic) return go("/login");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
