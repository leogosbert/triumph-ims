import type { SupabaseClient } from "@supabase/supabase-js";

/** The signed-in person, as far as the screens need it. */
export type SessionUser = {
  id: string;
  email?: string;
  is_anonymous: boolean;
  /** When this session signed in (from the token), used by the app lock and Security. */
  last_sign_in_at: string | null;
};

/**
 * Who is signed in, read from the session token instead of asking Supabase Auth over the network on
 * every screen. getClaims() checks the token's signature (with the project's public signing key,
 * cached) and its expiry; with an older shared-secret project it falls back to asking Auth, as before.
 * The database checks the same token on every query, so this gives the same protection, faster.
 */
export async function getSessionUser(supabase: SupabaseClient): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (error || !c?.sub) return null;
  // amr: how and when this session signed in; the latest time is the sign-in time.
  let at = 0;
  for (const a of c.amr ?? []) {
    if (typeof a === "object" && a && typeof a.timestamp === "number") at = Math.max(at, a.timestamp);
  }
  return {
    id: c.sub,
    email: typeof c.email === "string" && c.email ? c.email : undefined,
    is_anonymous: Boolean(c.is_anonymous),
    last_sign_in_at: at ? new Date(at * 1000).toISOString() : null,
  };
}
