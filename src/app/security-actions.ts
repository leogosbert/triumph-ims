"use server";

import { cookies } from "next/headers";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { recordEvent, stepUpOk } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

/** Called by the sign-in screens once the person is fully signed in (after two-step if they use it). */
export async function recordSignIn(): Promise<void> {
  const supabase = await createClient();
  await recordEvent(supabase, "sign_in");
}

/** Events the browser reports itself (the rest are recorded by the server actions that do the work). */
export async function recordBrowserEvent(kind: "two_step_on" | "two_step_off" | "reauth"): Promise<void> {
  if (kind !== "two_step_on" && kind !== "two_step_off" && kind !== "reauth") return;
  const supabase = await createClient();
  await recordEvent(supabase, kind);
}

/** Has this session confirmed who it is in the last 10 minutes (or is it the demo)? */
export async function identityFresh(): Promise<boolean> {
  const supabase = await createClient();
  const company = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value ?? null;
  return stepUpOk(supabase, company && /^[0-9a-f-]{36}$/i.test(company) ? company : null);
}

/** Signs this account out on every other phone and computer; this one stays signed in. */
export async function signOutOtherDevices(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false };
  await recordEvent(supabase, "sign_out_everywhere");
  return { ok: true };
}
