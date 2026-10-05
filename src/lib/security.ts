import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { deviceSummary, maskIp } from "@/lib/device";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Random id for this browser (httpOnly, long-lived). Only used to recognise "a device you have used before". */
export const DEVICE_COOKIE = "lemosp_did";
const DEVICE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

export type SecurityKind =
  | "sign_in"
  | "sign_out_everywhere"
  | "password_changed"
  | "two_step_on"
  | "two_step_off"
  | "reauth"
  | "export";

/** Error code the database uses for "Please confirm it is you first." */
export const STEP_UP_CODE = "28000";
export const STEP_UP_MESSAGE = "Please confirm it is you first.";

export function isStepUpError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === STEP_UP_CODE || error.message === STEP_UP_MESSAGE));
}

/** "Chrome on Android", a masked address, and (when allowed to set the cookie) a device key. */
async function requestDevice(setCookie: boolean) {
  const h = await headers();
  const device = deviceSummary(h.get("user-agent"));
  const ipHint = maskIp(h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip"));
  let key: string | null = null;
  try {
    const jar = await cookies();
    let did = jar.get(DEVICE_COOKIE)?.value ?? "";
    if (!/^[0-9a-f-]{36}$/.test(did)) {
      did = "";
      if (setCookie) {
        did = randomUUID();
        jar.set(DEVICE_COOKIE, did, DEVICE_COOKIE_OPTS);
      }
    } else if (setCookie) {
      jar.set(DEVICE_COOKIE, did, DEVICE_COOKIE_OPTS); // keep it alive
    }
    if (did) key = createHash("sha256").update(`${did}|${device}`).digest("hex");
  } catch {
    /* cookies are read-only here (server component): no key */
  }
  return { device, ipHint, key };
}

/**
 * Adds an entry to the person's sign-in history. Never throws: security logging must not
 * stop anyone working (e.g. before the database update has been run).
 */
export async function recordEvent(supabase: Supabase, kind: SecurityKind, companyId?: string | null): Promise<string | null> {
  try {
    const isSignIn = kind === "sign_in";
    const { device, ipHint, key } = await requestDevice(isSignIn);
    const company = companyId ?? (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value ?? null;
    const { data, error } = await supabase.rpc("record_security_event", {
      p_kind: kind,
      p_device: device,
      p_ip_hint: ipHint,
      p_company: company && /^[0-9a-f-]{36}$/i.test(company) ? company : null,
      p_device_key: isSignIn ? key : null,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * True when this session entered its password (or used an email link) in the last 10 minutes, whatever the company.
 * Used for the person's own account (password change). Before the database update: allow.
 */
export async function recentAuthOk(supabase: Supabase): Promise<boolean> {
  const { data, error } = await supabase.rpc("recent_auth", { p_minutes: 10 });
  if (error) return error.code === "PGRST202";
  return data === true;
}

/**
 * True when this session signed in (password / code) in the last 10 minutes, or it is a demo guest in their demo.
 * Before the database update has been run the check does not exist: allow (the database does not enforce it either).
 */
export async function stepUpOk(supabase: Supabase, companyId: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc("step_up_ok", { p_company: companyId });
  if (error) return error.code === "PGRST202" || /step_up_ok/.test(error.message ?? "") && /not find|does not exist/i.test(error.message ?? "");
  return data === true;
}
