"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { ACTIVITIES, isLevel, type BusinessProfile } from "@/lib/levels";
import { friendlyError, withNotice } from "@/lib/messages";

const NUMBER_KEYS = ["employees", "customers", "suppliers", "products", "warehouses", "branches", "monthly_sales", "monthly_transactions"] as const;
const YES_NO_KEYS = ["imports", "tenders", "corporate_clients", "services", "credit", "approvals"] as const;

/** Keeps only the known answers, as numbers / true-false / known activity keys. */
function cleanProfile(raw: unknown): BusinessProfile {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of NUMBER_KEYS) {
    const n = Number(src[k]);
    if (src[k] !== null && src[k] !== "" && src[k] !== undefined && Number.isFinite(n) && n >= 0 && n < 1e15) out[k] = Math.round(n);
  }
  for (const k of YES_NO_KEYS) if (typeof src[k] === "boolean") out[k] = src[k];
  const known = new Set(ACTIVITIES.map((a) => a.key));
  if (Array.isArray(src.activities)) out.activities = src.activities.filter((a): a is string => typeof a === "string" && known.has(a));
  return out as BusinessProfile;
}

/** Last step of onboarding: save the answers and the chosen level, then go home. */
export async function finishOnboarding(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect(withNotice("/", { error: "Only management can set up the company's business level." }));
  const level = String(form.get("level") ?? "");
  if (!isLevel(level)) redirect(withNotice("/onboarding", { error: "Please choose a level." }));
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(String(form.get("profile") ?? "{}"));
  } catch {
    parsed = {};
  }
  const { error } = await supabase.rpc("set_business_level", {
    p_company: company.id,
    p_level: level,
    p_profile: cleanProfile(parsed),
  });
  if (error) {
    const missing = /could not find the function|does not exist|schema cache/i.test(error.message ?? "");
    redirect(
      withNotice("/onboarding", {
        error: missing ? "Run the Stage 11 database update first (Supabase → SQL editor)." : friendlyError(error.message),
      }),
    );
  }
  revalidatePath("/", "layout");
  const msg =
    level === "small"
      ? "Welcome! Your workspace starts at Small level."
      : level === "medium"
        ? "Welcome! Your workspace starts at Medium level."
        : "Welcome! Your workspace starts at Enterprise level.";
  redirect(withNotice(`/?welcome=${level}`, { msg }));
}
