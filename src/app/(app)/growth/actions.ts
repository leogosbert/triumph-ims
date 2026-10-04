"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { isLevel } from "@/lib/levels";
import { friendlyError, withNotice } from "@/lib/messages";

const STAGE11 = "Run the Stage 11 database update first (Supabase → SQL editor).";

/** Only screens of this area may be returned to. */
function back(form: FormData) {
  const v = String(form.get("back") ?? "");
  return v === "/settings/features" || v === "/growth" || v === "/" ? v : "/growth";
}

function missing(message: string | undefined) {
  return /could not find the function|does not exist|schema cache/i.test(message ?? "");
}

function fail(path: string, message: string | undefined): never {
  redirect(withNotice(path, { error: missing(message) ? STAGE11 : friendlyError(message) }));
}

/** "Check now": look at recent activity for growth recommendations. */
export async function runGrowthCheck(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  const path = back(form);
  if (!isManager) redirect(path);
  const { data, error } = await supabase.rpc("run_growth_check", { p_company: company.id, p_force: true });
  if (error) fail(path, error.message);
  revalidatePath("/", "layout");
  redirect(
    withNotice(path, {
      msg: Number(data) > 0 ? "Growth check done. New recommendations are below." : "Growth check done. No new recommendations right now.",
    }),
  );
}

/** Accept, postpone (2 weeks) or dismiss one or more recommendations. */
export async function respondRecommendation(form: FormData) {
  const { supabase, isManager } = await getAppContext();
  const path = back(form);
  if (!isManager) redirect(path);
  const action = String(form.get("action") ?? "");
  if (!["accept", "postpone", "dismiss", "seen"].includes(action)) redirect(path);
  const ids = String(form.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (ids.length === 0) redirect(path);
  // Accepting a level suggestion once is enough; the other reasons for the same level go with it.
  const targets = action === "accept" ? ids.slice(0, 1) : ids;
  for (const id of targets) {
    const { error } = await supabase.rpc("respond_recommendation", { p_id: id, p_action: action, p_days: 14 });
    if (error) fail(path, error.message);
  }
  revalidatePath("/", "layout");
  const msg =
    action === "accept"
      ? "Done. The change is active now — nothing was lost."
      : action === "postpone"
        ? "We will remind you in 2 weeks."
        : action === "dismiss"
          ? "Recommendation dismissed."
          : "Saved.";
  redirect(withNotice(path, { msg }));
}

/** Switch one live feature on or off. */
export async function toggleFeature(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  const path = back(form);
  if (!isManager) redirect(path);
  const key = String(form.get("key") ?? "");
  const enabled = form.get("enabled") === "true";
  if (!/^[a-z0-9_]{2,60}$/.test(key)) redirect(path);
  const { error } = await supabase.rpc("set_company_feature", { p_company: company.id, p_key: key, p_enabled: enabled });
  if (error) fail(path, error.message);
  revalidatePath("/", "layout");
  const url = withNotice(path, {
    msg: enabled ? "Feature switched on. You can find it in the menu." : "Feature switched off. Its records are kept and come back when you switch it on.",
  });
  redirect(`${url}#${key}`);
}

/** Change the business level. Never deletes data or individual feature choices. */
export async function changeLevel(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  const path = back(form);
  if (!isManager) redirect(path);
  const level = String(form.get("level") ?? "");
  if (!isLevel(level)) redirect(path);
  const { error } = await supabase.rpc("set_business_level", { p_company: company.id, p_level: level, p_profile: null });
  if (error) fail(path, error.message);
  revalidatePath("/", "layout");
  redirect(
    withNotice(path, {
      msg:
        level === "small"
          ? "Your business level is now Small. All your records are kept."
          : level === "medium"
            ? "Your business level is now Medium. All your records are kept."
            : "Your business level is now Enterprise. All your records are kept.",
    }),
  );
}
