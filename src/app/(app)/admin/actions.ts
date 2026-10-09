"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { onAdminHost } from "@/lib/hosts-server";
import { platformAdmin } from "./guard";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isMissingSql, LEVELS, STAGE11_MISSING } from "@/components/suggestions/meta";
import { METRIC_KEYS, OPS } from "./rules/meta";
import { CATEGORIES_MISSING, categoryHref } from "./categories";

type DbError = { code?: string | null; message?: string | null } | null;

function explain(error: DbError, missing: string = STAGE11_MISSING): string {
  if (isMissingSql(error)) return missing;
  if (/duplicate key/i.test(error?.message ?? "")) return "That key is already used. Choose another key.";
  return friendlyError(error?.message);
}

/** Every admin action checks again on the server; the database functions check a third time. */
async function requireAdmin() {
  // Only the signed-in person is needed (no company): works on the LeMoSp ADMIN address too.
  const { supabase, ok } = await platformAdmin();
  if (!ok) redirect(withNotice((await onAdminHost()) ? "/admin" : "/", { error: "That area is only for the LeMo Tech platform team." }));
  return supabase;
}

const isLevel = (v: string) => (LEVELS as readonly string[]).includes(v);
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);
const KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

/* ---------------- Companies ---------------- */

export async function setCompanyLevel(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "company_id"));
  if (!id) redirect("/admin/companies");
  const back = `/admin/companies/${id}`;
  const level = str(form, "level");
  if (!isLevel(level)) redirect(withNotice(back, { error: "Choose a level." }));
  const { error } = await supabase.rpc("admin_set_company_level", { p_company: id, p_level: level });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  revalidatePath("/admin", "layout");
  redirect(withNotice(back, { msg: "Business level changed. No data was removed." }));
}

export async function setCompanyFeature(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "company_id"));
  if (!id) redirect("/admin/companies");
  const back = `/admin/companies/${id}`;
  const key = str(form, "key");
  const choice = str(form, "enabled");
  // "default" = back to what the company's level gives (needs the feature categories SQL for the
  // screen to show it, but the database function has always accepted it).
  const enabled = choice === "on" ? true : choice === "off" ? false : null;
  if (!KEY_RE.test(key)) redirect(withNotice(back, { error: "Unknown feature." }));
  const { error } = await supabase.rpc("admin_set_company_feature", { p_company: id, p_key: key, p_enabled: enabled });
  if (error) redirect(withNotice(`${back}#features`, { error: explain(error) }));
  revalidatePath("/admin", "layout");
  const msg =
    enabled === true
      ? "Feature switched on for this company."
      : enabled === false
        ? "Feature switched off for this company."
        : "Feature set back to the level default for this company.";
  redirect(withNotice(`${back}#features`, { msg }));
}

export async function setCompanyCategory(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "company_id"));
  if (!id) redirect("/admin/companies");
  const back = `/admin/companies/${id}`;
  const category = str(form, "category");
  const choice = str(form, "enabled");
  const enabled = choice === "on" ? true : choice === "off" ? false : null;
  if (!category) redirect(withNotice(back, { error: "Unknown category." }));
  const { error } = await supabase.rpc("admin_set_company_category", { p_company: id, p_category: category, p_enabled: enabled });
  if (error) redirect(withNotice(`${back}#features`, { error: explain(error, CATEGORIES_MISSING) }));
  revalidatePath("/admin", "layout");
  const msg =
    enabled === true
      ? "Every feature in the category is now on for this company."
      : enabled === false
        ? "Every feature in the category is now off for this company."
        : "The category is back to the level default for this company.";
  redirect(withNotice(`${back}#features`, { msg }));
}

/* ---------------- Features catalogue ---------------- */

export async function saveFeature(form: FormData) {
  const supabase = await requireAdmin();
  const isNew = str(form, "is_new") === "1";
  const key = str(form, "key");
  const back = `/admin/features/${isNew ? "new" : encodeURIComponent(key)}`;
  if (!KEY_RE.test(key) || key === "new" || key === "categories") {
    redirect(withNotice(back, { error: "The key must be lower-case letters, numbers and _ (e.g. stock_transfers)." }));
  }

  const name = str(form, "name");
  const description = str(form, "description");
  const module = str(form, "module");
  const defaultLevel = str(form, "default_level");
  const status = str(form, "status");
  const route = optional(form, "route");
  const sortRaw = str(form, "sort");
  const sort = sortRaw === "" ? 0 : Number(sortRaw);
  if (name.length < 2 || name.length > 80) redirect(withNotice(back, { error: "Give the feature a name (2–80 letters)." }));
  if (description.length > 600) redirect(withNotice(back, { error: "The description is too long (600 letters at most)." }));
  if (!isLevel(defaultLevel)) redirect(withNotice(back, { error: "Choose the default level." }));
  if (status !== "live" && status !== "planned") redirect(withNotice(back, { error: "Choose live or planned." }));
  if (!Number.isInteger(sort) || sort < 0 || sort > 100000) redirect(withNotice(back, { error: "Sort must be a whole number." }));
  if (route && (!route.startsWith("/") || route.startsWith("//") || route.length > 120)) {
    redirect(withNotice(back, { error: "The screen address must start with / (e.g. /stock)." }));
  }

  const titles = form.getAll("tutorial_title").map((v) => String(v).trim());
  const bodies = form.getAll("tutorial_body").map((v) => String(v).trim());
  const tutorial = titles
    .map((title, i) => ({ title: title.slice(0, 80), body: (bodies[i] ?? "").slice(0, 600) }))
    .filter((s) => s.title || s.body);
  if (tutorial.some((s) => !s.title)) redirect(withNotice(back, { error: "Every tutorial step needs a title." }));
  if (tutorial.length > 10) redirect(withNotice(back, { error: "Keep tutorials to 10 steps or fewer." }));

  const row = {
    name,
    description: description || null,
    module: module || "Other",
    default_level: defaultLevel,
    status,
    audience: optional(form, "audience"),
    benefits: optional(form, "benefits"),
    tutorial,
    route,
    sort,
    active: form.get("active") === "on",
  };
  const { error } = isNew
    ? await supabase.from("features").insert({ key, ...row })
    : await supabase.from("features").update(row).eq("key", key).select("key").single();
  if (error) redirect(withNotice(back, { error: explain(error) }));
  revalidatePath("/admin", "layout");
  redirect(withNotice(`/admin/features/${encodeURIComponent(key)}`, { msg: isNew ? "Feature added." : "Feature saved." }));
}

/* ---------------- Feature categories ---------------- */

export async function saveCategory(form: FormData) {
  const supabase = await requireAdmin();
  const oldName = str(form, "old_name") || null;
  const name = str(form, "name").trim();
  const description = str(form, "description").trim();
  const sortRaw = str(form, "sort");
  const sort = sortRaw === "" ? 100 : Number(sortRaw);
  const back = oldName ? categoryHref(oldName) : "/admin/features/categories";
  if (name.length < 2 || name.length > 60) redirect(withNotice(back, { error: "Give the category a name (2–60 letters)." }));
  if (description.length > 300) redirect(withNotice(back, { error: "The description is too long (300 letters at most)." }));
  if (!Number.isInteger(sort) || sort < 0 || sort > 100000) redirect(withNotice(back, { error: "Sort must be a whole number." }));
  const { data, error } = await supabase.rpc("admin_save_feature_category", {
    p_old_name: oldName,
    p_name: name,
    p_description: description,
    p_sort: sort,
  });
  if (error) {
    const msg = /already exists/i.test(error.message ?? "") ? "A category with that name already exists." : explain(error, CATEGORIES_MISSING);
    redirect(withNotice(back, { error: msg }));
  }
  revalidatePath("/admin", "layout");
  redirect(withNotice(categoryHref(typeof data === "string" ? data : name), { msg: oldName ? "Category saved." : "Category added." }));
}

export async function deleteCategory(form: FormData) {
  const supabase = await requireAdmin();
  const name = str(form, "name");
  const moveTo = str(form, "move_to") || null;
  const back = categoryHref(name);
  if (form.get("confirm") !== "on") redirect(withNotice(`${back}#remove`, { error: "Tick the box to confirm removing this category." }));
  const { data, error } = await supabase.rpc("admin_delete_feature_category", { p_name: name, p_move_to: moveTo });
  if (error) {
    const msg = /choose another category/i.test(error.message ?? "")
      ? "Choose where its features should go."
      : explain(error, CATEGORIES_MISSING);
    redirect(withNotice(`${back}#remove`, { error: msg }));
  }
  revalidatePath("/admin", "layout");
  const moved = typeof data === "number" && data > 0;
  redirect(withNotice("/admin/features/categories", { msg: moved ? "Category removed. Its features were moved." : "Category removed." }));
}

/** Add a feature to a category (which takes it out of its old one). */
export async function setFeatureCategory(form: FormData) {
  const supabase = await requireAdmin();
  const key = str(form, "key");
  const category = str(form, "category");
  const back = str(form, "back") ? categoryHref(str(form, "back")) : "/admin/features";
  if (!KEY_RE.test(key)) redirect(withNotice(back, { error: "Choose a feature." }));
  if (!category) redirect(withNotice(back, { error: "Choose a category." }));
  const { error } = await supabase.rpc("admin_set_feature_category", { p_key: key, p_category: category });
  if (error) redirect(withNotice(back, { error: explain(error, CATEGORIES_MISSING) }));
  revalidatePath("/admin", "layout");
  redirect(withNotice(back, { msg: "Feature moved." }));
}

/* ---------------- Growth rules ---------------- */

export async function saveRule(form: FormData) {
  const supabase = await requireAdmin();
  const isNew = str(form, "is_new") === "1";
  const key = str(form, "key");
  const back = `/admin/rules/${isNew ? "new" : encodeURIComponent(key)}`;
  if (!KEY_RE.test(key) || key === "new") redirect(withNotice(back, { error: "The key must be lower-case letters, numbers and _ (e.g. many_products)." }));

  const title = str(form, "title");
  const metric = str(form, "metric");
  const op = str(form, "op");
  const thresholdRaw = str(form, "threshold").replace(/,/g, "");
  const threshold = Number(thresholdRaw);
  const targetType = str(form, "target_type");
  const featureKey = str(form, "feature_key");
  const targetLevel = str(form, "target_level");
  const appliesTo = form.getAll("applies_to").map(String).filter(isLevel);
  const message = str(form, "message");
  const sortRaw = str(form, "sort");
  const sort = sortRaw === "" ? 0 : Number(sortRaw);

  if (title.length < 2 || title.length > 120) redirect(withNotice(back, { error: "Give the rule a title (2–120 letters)." }));
  if (!METRIC_KEYS.includes(metric)) redirect(withNotice(back, { error: "Choose what to measure." }));
  if (!OPS.includes(op)) redirect(withNotice(back, { error: "Choose a comparison." }));
  if (thresholdRaw === "" || !Number.isFinite(threshold) || threshold < 0) redirect(withNotice(back, { error: "Enter a threshold (a number, 0 or more)." }));
  if (targetType !== "feature" && targetType !== "level") redirect(withNotice(back, { error: "Choose what to recommend." }));
  if (targetType === "feature" && !KEY_RE.test(featureKey)) redirect(withNotice(back, { error: "Choose the feature to recommend." }));
  if (targetType === "level" && !isLevel(targetLevel)) redirect(withNotice(back, { error: "Choose the level to recommend." }));
  if (appliesTo.length === 0) redirect(withNotice(back, { error: "Tick at least one level the rule applies to." }));
  if (targetType === "level" && appliesTo.some((l) => LEVELS.indexOf(l as never) >= LEVELS.indexOf(targetLevel as never))) {
    redirect(withNotice(back, { error: "A level recommendation only makes sense for companies below that level." }));
  }
  if (message.length > 500) redirect(withNotice(back, { error: "The message is too long (500 letters at most)." }));
  if (!Number.isInteger(sort) || sort < 0 || sort > 100000) redirect(withNotice(back, { error: "Sort must be a whole number." }));

  const row = {
    title,
    metric,
    op,
    threshold,
    feature_key: targetType === "feature" ? featureKey : null,
    target_level: targetType === "level" ? targetLevel : null,
    applies_to: appliesTo,
    message: message || null,
    active: form.get("active") === "on",
    sort,
  };
  const { error } = isNew
    ? await supabase.from("recommendation_rules").insert({ key, ...row })
    : await supabase.from("recommendation_rules").update(row).eq("key", key).select("key").single();
  if (error) redirect(withNotice(back, { error: explain(error) }));
  revalidatePath("/admin", "layout");
  redirect(withNotice(`/admin/rules/${encodeURIComponent(key)}`, { msg: isNew ? "Rule added." : "Rule saved." }));
}

export async function deleteRule(form: FormData) {
  const supabase = await requireAdmin();
  const key = str(form, "key");
  if (!KEY_RE.test(key)) redirect("/admin/rules");
  if (form.get("confirm") !== "on") {
    redirect(withNotice(`/admin/rules/${encodeURIComponent(key)}#delete`, { error: "Tick the box to confirm deleting this rule." }));
  }
  const { error } = await supabase.from("recommendation_rules").delete().eq("key", key).select("key").single();
  if (error) redirect(withNotice(`/admin/rules/${encodeURIComponent(key)}`, { error: explain(error) }));
  revalidatePath("/admin", "layout");
  redirect(withNotice("/admin/rules", { msg: "Rule deleted. Recommendations it created have been removed." }));
}
