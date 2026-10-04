"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
const ROLES = ["management", "sales", "procurement", "warehouse", "driver", "finance"];

/** "Try the demo": signs in as a guest (no email needed) and builds a demo company with sample data. */
export async function startDemo() {
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
  const { data, error } = await supabase.rpc("create_demo_company");
  if (error) redirect(withNotice("/login", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(withNotice("/", { msg: "Welcome to the LeMoSp demo. Everything here is sample data — try anything." }));
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

/** Demo only: throw the sample data away and start again. */
export async function restartDemo() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_demo_company");
  if (error) redirect(withNotice("/", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(withNotice("/", { msg: "Fresh demo data is ready." }));
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
