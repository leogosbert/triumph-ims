"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  redirect("/login");
}

export async function createCompany(form: FormData) {
  const name = str(form, "name");
  if (name.length < 2) redirect(withNotice("/welcome", { error: "Please enter the company name." }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_company", { p_name: name });
  if (error) redirect(withNotice("/welcome", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(withNotice("/", { msg: `${name} is set up. Start with the checklist below.` }));
}

export async function acceptInvitation(form: FormData) {
  const id = str(form, "invitation_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_invitation: id });
  if (error) redirect(withNotice("/welcome", { error: friendlyError(error.message) }));
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, String(data), COOKIE_OPTS);
  redirect(withNotice("/", { msg: "Welcome to the team." }));
}

export async function switchCompany(form: FormData) {
  const id = str(form, "company_id");
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, COOKIE_OPTS);
  redirect("/");
}
