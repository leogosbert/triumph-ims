"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { str } from "@/lib/format";
import { isLevel, type Level } from "@/lib/levels";
import { friendlyError, withNotice } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
const ROLES = ["management", "sales", "procurement", "warehouse", "driver", "finance"];

type Supabase = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message?: string } | null | undefined;

/** The demo level asked for in a form ("small" | "medium" | "enterprise"); Medium when missing or unknown. */
function levelOf(form?: unknown): Level {
  if (form instanceof FormData) {
    const v = str(form, "level");
    if (isLevel(v)) return v;
  }
  return "medium";
}

/** The database function (or its p_level parameter) does not exist yet: the Stage 12 SQL has not been run. */
function missingFunction(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.code === "42704" ||
    /p_level|could not find the function|does not exist|schema cache|business_level/i.test(error.message ?? "")
  );
}

/**
 * Builds a demo company at a level. Before the Stage 12 database update the function takes no
 * level: then the old single (medium) demo is built instead.
 */
async function createDemo(supabase: Supabase, level: Level) {
  const withLevel = await supabase.rpc("create_demo_company", { p_level: level });
  if (!withLevel.error || !missingFunction(withLevel.error)) return withLevel;
  return supabase.rpc("create_demo_company");
}

/**
 * Home, with the quick guide for that level starting by itself. `fresh` (a new demo) also makes
 * the guide forget which scales were already seen in an earlier demo.
 */
function homeWithTour(level: Level, msg: string, fresh = false) {
  return withNotice(`/?tour=${level}${fresh ? "&tourfresh=1" : ""}`, { msg });
}

/**
 * "Try the demo": signs in as a guest (no email needed) and builds a demo company with sample data.
 * The form may carry `level` (small | medium | enterprise); without a form the Medium demo opens.
 */
export async function startDemo(form?: FormData) {
  const level = levelOf(form);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      const off = /anonymous/i.test(error.message) && /disabled|not enabled|not allowed/i.test(error.message);
      redirect(
        withNotice("/login", {
          error: off
            ? "The demo is not switched on yet. (Supabase: Authentication → Sign In / Providers → allow anonymous sign-ins.)"
            : "The demo could not start. Please try again in a minute.",
        }),
      );
    }
  }
  const { data, error } = await createDemo(supabase, level);
  if (error) redirect(withNotice("/login", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(homeWithTour(level, "Welcome to the LeMoSp demo. Everything here is sample data — try anything.", true));
}

/** Demo only: look at the app as another role (Sales, Driver, Finance …). */
export async function setDemoRole(form: FormData) {
  const role = str(form, "role");
  if (!ROLES.includes(role)) redirect("/");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_demo_role", { p_role: role });
  if (error) redirect(withNotice("/", { error: friendlyError(error.message) }));
  redirect("/");
}

/** Demo only: throw the sample data away and start again, at the same demo level. */
export async function restartDemo() {
  const supabase = await createClient();
  let level: Level = "medium";
  try {
    const { data: current, error: levelError } = await supabase.rpc("my_demo_level");
    if (!levelError && isLevel(current)) level = current;
  } catch {
    /* before the Stage 12 update: the single medium demo */
  }
  const { data, error } = await createDemo(supabase, level);
  if (error) redirect(withNotice("/", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(withNotice("/", { msg: "Fresh demo data is ready." }));
}

/** Demo only: swap to the Small, Medium or Enterprise demo company, then start its tour. */
export async function switchDemoLevel(form: FormData) {
  const raw = str(form, "level");
  if (!isLevel(raw)) redirect("/");
  const level: Level = raw;
  const supabase = await createClient();
  let result = await supabase.rpc("switch_demo_level", { p_level: level });
  // Before the Stage 12 update there is no switch: build the demo again instead.
  if (result.error && missingFunction(result.error)) result = await createDemo(supabase, level);
  if (result.error) redirect(withNotice("/", { error: friendlyError(result.error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(result.data), COOKIE_OPTS);
  redirect(
    homeWithTour(
      level,
      level === "small"
        ? "You are now in the Small business demo."
        : level === "enterprise"
          ? "You are now in the Large (Enterprise) demo."
          : "You are now in the Medium business demo.",
    ),
  );
}

/** Leave the demo: deletes the demo company; guests are signed out. */
export async function exitDemo() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.rpc("end_demo");
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  if (!user || user.is_anonymous) {
    await supabase.auth.signOut();
    redirect(withNotice("/login", { msg: "Thanks for trying LeMoSp. Create an account when you're ready." }));
  }
  redirect("/");
}

/**
 * End of the guides ("Choose the one that fits my business"): leaves the demo and goes to where
 * a real company is set up. Guests go to "Create account"; signed-in people go to the level
 * set-up of their company (or to "Create your company" when they have none yet).
 */
export async function leaveDemoToChoose() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.rpc("end_demo");
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  if (!user || user.is_anonymous) {
    await supabase.auth.signOut();
    redirect(
      withNotice("/login?mode=signup", {
        msg: "Create your free account. Then you choose the scale that fits your business, and you can change it at any time.",
      }),
    );
  }
  redirect("/onboarding");
}
