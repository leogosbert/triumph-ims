import { cache } from "react";
import { redirect } from "next/navigation";
import { displayName, type Profile } from "@/lib/context";
import { primeLang } from "@/lib/tr";
import { createClient } from "@/lib/supabase/server";
import { isMissingSql } from "@/components/suggestions/meta";

/**
 * Is the signed-in person a LeMo Tech platform admin?
 * Any error (including the Stage 11 SQL not being run yet) counts as "no".
 *
 * Needs only the signed-in person, not a company: on the LeMoSp ADMIN address a platform admin
 * may belong to no company at all (getAppContext would send them to /welcome).
 */
export const platformAdmin = cache(async () => {
  await primeLang();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Two-step verification is on for this person: they must enter their code first.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/two-step");

  const [{ data, error }, { data: profile }] = await Promise.all([
    supabase.rpc("is_platform_admin"),
    supabase.from("profiles").select("id, full_name, email, phone").eq("id", user.id).maybeSingle(),
  ]);
  return {
    ok: !error && data === true,
    missingSql: isMissingSql(error),
    supabase,
    name: displayName((profile as Profile | null) ?? { full_name: null, email: user.email ?? null }),
  };
});
